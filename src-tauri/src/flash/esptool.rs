//! esptool.py integration: shell out to `esptool.py` (or `python3 -m esptool`)
//! to flash a patched firmware.bin over the detected CH341 serial port.
//!
//! Design: a `FlashRunner` trait abstracts the subprocess so tests can mock it.
//! Real flashing uses `CommandFlashRunner` which spawns `esptool.py`.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::process::Command;

/// Abstraction over the esptool subprocess so tests can inject a fake runner.
pub trait FlashRunner {
    /// Run esptool with the given args. Returns combined stdout+stderr on
    /// success, or an error message on non-zero exit.
    fn run(&mut self, args: &[&str]) -> Result<String, String>;
}

/// Real implementation: spawns `esptool.py` (falling back to
/// `python3 -m esptool`) as a subprocess.
pub struct CommandFlashRunner {
    /// Override the esptool invocation. If empty, auto-detect.
    program: Option<String>,
}

impl CommandFlashRunner {
    pub fn new() -> Self {
        Self { program: None }
    }

    /// Force a specific program (e.g. `esptool.py` or `python3`).
    pub fn with_program(program: impl Into<String>) -> Self {
        Self {
            program: Some(program.into()),
        }
    }

    fn resolve_invocation(&self) -> (String, Vec<String>) {
        if let Some(prog) = &self.program {
            if prog == "python3" || prog == "python" {
                (prog.clone(), vec!["-m".to_string(), "esptool".to_string()])
            } else {
                (prog.clone(), vec![])
            }
        } else {
            ("esptool.py".to_string(), vec![])
        }
    }
}

impl Default for CommandFlashRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl FlashRunner for CommandFlashRunner {
    fn run(&mut self, args: &[&str]) -> Result<String, String> {
        let (program, mut prefix) = self.resolve_invocation();
        let arg_strings: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        prefix.extend(arg_strings);

        let output = Command::new(&program)
            .args(&prefix)
            .output()
            .map_err(|e| format!("failed to spawn {program}: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let combined = format!("{stdout}{stderr}");

        if output.status.success() {
            Ok(combined)
        } else {
            Err(combined)
        }
    }
}

/// Build the esptool CLI args for a write_flash operation.
///
/// Produces: `["--port", port, "--baud", "921600", "write_flash", "0x10000", binary_path]`
pub fn build_cli_args(port: &str, baud: u32, binary_path: &str) -> Vec<String> {
    vec![
        "--port".to_string(),
        port.to_string(),
        "--baud".to_string(),
        baud.to_string(),
        "write_flash".to_string(),
        "0x10000".to_string(),
        binary_path.to_string(),
    ]
}

/// Compute the SHA256 hex digest of the file at `binary_path`.
pub fn compute_sha256(binary_path: &str) -> Result<String, String> {
    let bytes = fs::read(binary_path)
        .map_err(|e| format!("failed to read {binary_path}: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

/// Verify the SHA256 of `binary_path` matches `expected` (hex, lowercase).
pub fn verify_sha256(binary_path: &str, expected: &str) -> Result<bool, String> {
    let actual = compute_sha256(binary_path)?;
    Ok(actual.eq_ignore_ascii_case(expected.trim()))
}

/// Parsed progress event from esptool stderr.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlashProgress {
    pub percentage: u8,
    pub stage: String,
}

impl FlashProgress {
    /// Parse the first progress line out of an esptool output chunk.
    ///
    /// Recognizes lines like `Writing at 0x00010000 (12%)` and maps them to
    /// `FlashProgress { percentage: 12, stage: "writing" }`.
    pub fn parse(output: &str) -> Option<Self> {
        for line in output.lines() {
            let trimmed = line.trim();
            if let Some(p) = parse_writing_line(trimmed) {
                return Some(p);
            }
        }
        None
    }
}

fn parse_writing_line(line: &str) -> Option<FlashProgress> {
    // Match "Writing at 0xADDR (N%)" — case-insensitive on "Writing".
    let lower = line.to_ascii_lowercase();
    let key = "writing at";
    let idx = lower.find(key)?;
    let rest = &line[idx + key.len()..].trim_start();
    // rest looks like "0x00010000 (12%)"
    let paren = rest.find('(')?;
    let after = &rest[paren + 1..];
    let close = after.find(')')?;
    let num_str = after[..close].trim_end_matches('%').trim();
    let percentage: u8 = num_str.parse().ok()?;
    Some(FlashProgress {
        percentage,
        stage: "writing".to_string(),
    })
}

/// Default baud rate used for flashing.
pub const DEFAULT_BAUD: u32 = 921600;

/// Verify SHA256, then run the flasher. Returns `Ok(())` on success.
pub fn flash_firmware_with<R: FlashRunner>(
    runner: &mut R,
    port: &str,
    binary_path: &str,
    expected_sha256: &str,
) -> Result<(), String> {
    if !Path::new(binary_path).exists() {
        return Err(format!("binary not found: {binary_path}"));
    }
    if !verify_sha256(binary_path, expected_sha256)? {
        return Err("SHA256 mismatch — refusing to flash".to_string());
    }
    let args = build_cli_args(port, DEFAULT_BAUD, binary_path);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = runner.run(&arg_refs)?;
    // Surface the final progress event if present (best-effort).
    if let Some(_progress) = FlashProgress::parse(&output) {
        // Caller (command layer) parses streaming events; here we just confirm.
    }
    Ok(())
}

/// Public entry point: flash using the real `CommandFlashRunner`.
pub fn flash_firmware(port: &str, binary_path: &str, expected_sha256: &str) -> Result<(), String> {
    let mut runner = CommandFlashRunner::new();
    flash_firmware_with(&mut runner, port, binary_path, expected_sha256)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Mock runner that returns a canned output or error.
    struct MockFlashRunner {
        response: Result<String, String>,
        captured_args: Vec<String>,
    }

    impl MockFlashRunner {
        fn success(output: &str) -> Self {
            Self {
                response: Ok(output.to_string()),
                captured_args: Vec::new(),
            }
        }

        fn failure(err: &str) -> Self {
            Self {
                response: Err(err.to_string()),
                captured_args: Vec::new(),
            }
        }
    }

    impl FlashRunner for MockFlashRunner {
        fn run(&mut self, args: &[&str]) -> Result<String, String> {
            self.captured_args = args.iter().map(|s| s.to_string()).collect();
            self.response.clone()
        }
    }

    #[test]
    fn builds_correct_cli_args() {
        let args = build_cli_args("/dev/ttyUSB0", 921600, "/path/fw.bin");
        assert_eq!(
            args,
            vec![
                "--port",
                "/dev/ttyUSB0",
                "--baud",
                "921600",
                "write_flash",
                "0x10000",
                "/path/fw.bin"
            ]
        );
    }

    #[test]
    fn verifies_sha256_before_flash() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let path = dir.path().join("fw.bin");
        let mut f = fs::File::create(&path).map_err(|e| e.to_string())?;
        f.write_all(b"hello world").map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        drop(f);

        let path_str = path.to_str().unwrap();
        // Known SHA256 of "hello world"
        let correct = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
        let wrong = "0000000000000000000000000000000000000000000000000000000000000000";

        assert!(verify_sha256(path_str, correct)?);
        assert!(!verify_sha256(path_str, wrong)?);
        Ok(())
    }

    #[test]
    fn reports_progress_events() {
        let fake_stderr = "esptool.py v4.6\nSerial port /dev/ttyUSB0\nConnecting...\nWriting at 0x00010000 (12%)\nWriting at 0x00020000 (24%)\nHash of data verified.";
        let progress = FlashProgress::parse(fake_stderr).expect("should parse progress");
        assert_eq!(
            progress,
            FlashProgress {
                percentage: 12,
                stage: "writing".to_string()
            }
        );
    }

    #[test]
    fn flash_firmware_returns_ok_on_success() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let path = dir.path().join("fw.bin");
        let mut f = fs::File::create(&path).map_err(|e| e.to_string())?;
        f.write_all(b"hello world").map_err(|e| e.to_string())?;
        drop(f);

        let path_str = path.to_str().unwrap().to_string();
        let correct = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

        let mut runner = MockFlashRunner::success("Hash of data verified.");
        let result = flash_firmware_with(&mut runner, "/dev/ttyUSB0", &path_str, correct);
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
        Ok(())
    }

    #[test]
    fn flash_firmware_fails_on_sha_mismatch() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let path = dir.path().join("fw.bin");
        let mut f = fs::File::create(&path).map_err(|e| e.to_string())?;
        f.write_all(b"hello world").map_err(|e| e.to_string())?;
        drop(f);

        let path_str = path.to_str().unwrap().to_string();
        let wrong = "0000000000000000000000000000000000000000000000000000000000000000";

        let mut runner = MockFlashRunner::success("Hash of data verified.");
        let result = flash_firmware_with(&mut runner, "/dev/ttyUSB0", &path_str, wrong);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .contains("SHA256 mismatch"),
            "should mention SHA256 mismatch"
        );
        Ok(())
    }

    #[test]
    fn flash_firmware_fails_on_runner_error() -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let path = dir.path().join("fw.bin");
        let mut f = fs::File::create(&path).map_err(|e| e.to_string())?;
        f.write_all(b"hello world").map_err(|e| e.to_string())?;
        drop(f);

        let path_str = path.to_str().unwrap().to_string();
        let correct = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

        let mut runner = MockFlashRunner::failure("A fatal error occurred: Failed to connect to ESP32");
        let result = flash_firmware_with(&mut runner, "/dev/ttyUSB0", &path_str, correct);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("fatal error"));
        Ok(())
    }
}
