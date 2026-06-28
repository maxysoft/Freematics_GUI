//! Smoke test: assert the app ships as a **portable** bundle (no installers)
//! and that the firmware dist artifacts are present and bundled as resources.
//!
//! Runs inside the dev container. Paths resolve relative to the workspace
//! root (parent of `src-tauri`) via `CARGO_MANIFEST_DIR`.

use std::path::PathBuf;

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must have a parent workspace dir")
        .to_path_buf()
}

fn read_conf() -> serde_json::Value {
    let conf_path = workspace_root().join("src-tauri/tauri.conf.json");
    let raw = std::fs::read_to_string(&conf_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", conf_path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("failed to parse {}: {e}", conf_path.display()))
}

/// The bundle must only target portable formats — no NSIS, MSI, or DEB.
#[test]
fn bundle_targets_are_portable_only() {
    let conf = read_conf();
    let targets = conf
        .get("bundle")
        .and_then(|b| b.get("targets"))
        .expect("bundle.targets missing");
    let target_strs: Vec<String> = targets
        .as_array()
        .expect("bundle.targets must be an array")
        .iter()
        .map(|v| v.as_str().unwrap_or("").to_string())
        .collect();

    for forbidden in &["nsis", "msi", "deb", "rpm", "app"] {
        // "app" is the portable executable target and is allowed.
        if *forbidden == "app" {
            continue;
        }
        assert!(
            !target_strs.iter().any(|t| t == forbidden),
            "bundle.targets must not contain installer format `{forbidden}` (found {target_strs:?}); portable-only release required"
        );
    }
    assert!(
        target_strs.iter().any(|t| t == "app"),
        "bundle.targets must include `app` (portable executable): {target_strs:?}"
    );
}

/// Firmware dist files are embedded via include_str!/include_bytes! at compile
/// time rather than bundled as Tauri resources, so the portable exe is fully
/// self-contained with no runtime file resolution. Verify the source files
/// exist in the repo so the compile-time includes don't break the build.
#[test]
fn firmware_dist_files_compile_time_embedded() {
    let dist = workspace_root().join("firmware/dist");
    assert!(
        dist.join("manifest.json").exists(),
        "firmware/dist/manifest.json missing — required for include_str! in commands.rs"
    );
    assert!(
        dist.join("telelogger-patched.bin").exists(),
        "firmware/dist/telelogger-patched.bin missing — required for include_bytes! in commands.rs"
    );
}


/// The manifest must be valid JSON with the expected fields.
#[test]
fn firmware_manifest_is_valid() {
    let manifest_path = workspace_root().join("firmware/dist/manifest.json");
    let raw = std::fs::read_to_string(&manifest_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", manifest_path.display()));
    let value: serde_json::Value =
        serde_json::from_str(&raw).expect("manifest.json is not valid JSON");

    for key in &["version", "sha256", "binary", "built_from_commit"] {
        assert!(
            value.get(key).is_some(),
            "manifest.json missing required field `{key}`"
        );
    }
    let sha = value
        .get("sha256")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert!(
        !sha.is_empty(),
        "manifest.json sha256 must be non-empty"
    );
}

/// The release workflow must exist and target the release branch.
#[test]
fn release_workflow_targets_release_branch() {
    let wf_path = workspace_root().join(".github/workflows/release.yml");
    let raw = std::fs::read_to_string(&wf_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", wf_path.display()));
    assert!(
        raw.contains("branches:") && raw.contains("release"),
        "release.yml must trigger on the release branch"
    );
    assert!(
        raw.contains("softprops/action-gh-release"),
        "release.yml must create a GitHub Release via softprops/action-gh-release"
    );
}
