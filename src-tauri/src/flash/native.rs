//! Native, self-contained ESP32 flashing via the `espflash` crate.
//!
//! No external esptool / Python — the flasher is compiled into the binary so a
//! brand-new device can be set up with this app alone. Replaces the previous
//! `esptool.py` subprocess.

use espflash::connection::{Connection, ResetAfterOperation, ResetBeforeOperation};
use espflash::flasher::Flasher;
use espflash::target::{Chip, ProgressCallbacks};
use serialport::UsbPortInfo;
use std::time::Duration;

/// Flash offset of the telelogger application image on the ESP32 (factory
/// bootloader + partition table are already present on Freematics hardware).
pub const APP_FLASH_ADDR: u32 = 0x10000;
const CONNECT_BAUD: u32 = 115_200;
const FLASH_BAUD: u32 = 460_800;

/// Forwards espflash progress to a closure as a 0..=100 percentage.
struct Progress<F: FnMut(u8)> {
    total: usize,
    cb: F,
}

impl<F: FnMut(u8)> ProgressCallbacks for Progress<F> {
    fn init(&mut self, _addr: u32, total: usize) {
        self.total = total;
        (self.cb)(0);
    }

    fn update(&mut self, current: usize) {
        let pct = if self.total == 0 {
            0
        } else {
            ((current.saturating_mul(100)) / self.total).min(100) as u8
        };
        (self.cb)(pct);
    }

    fn verifying(&mut self) {}

    fn finish(&mut self, _skipped: bool) {
        (self.cb)(100);
    }
}

/// Flash a raw application image to the ESP32 over `port_path`, reporting
/// progress (0..=100) via `on_progress`. Blocking; call off the async runtime.
pub fn flash_bin<F: FnMut(u8)>(
    port_path: &str,
    data: &[u8],
    on_progress: F,
) -> Result<(), String> {
    log::info!(
        "native flash: {} bytes -> {port_path} at {:#x}",
        data.len(),
        APP_FLASH_ADDR
    );

    // espflash's Connection wants the platform-native port (TTYPort/COMPort),
    // so open_native() rather than the boxed dyn from open().
    let serial = serialport::new(port_path, CONNECT_BAUD)
        .timeout(Duration::from_secs(10))
        .open_native()
        .map_err(|e| format!("failed to open {port_path} for flashing: {e}"))?;

    let port_info = UsbPortInfo {
        vid: 0x1a86,
        pid: 0x7523,
        serial_number: None,
        manufacturer: None,
        product: None,
    };

    let connection = Connection::new(
        serial,
        port_info,
        ResetAfterOperation::HardReset,
        ResetBeforeOperation::DefaultReset,
        CONNECT_BAUD,
    );

    let mut flasher = Flasher::connect(
        connection,
        true,            // use_stub — faster, more reliable
        false,           // verify (we SHA-check the source file ourselves)
        false,           // skip
        Some(Chip::Esp32),
        Some(FLASH_BAUD),
    )
    .map_err(|e| format!("could not connect to the ESP32 bootloader on {port_path}: {e}"))?;

    let mut progress = Progress {
        total: 0,
        cb: on_progress,
    };
    flasher
        .write_bin_to_flash(APP_FLASH_ADDR, data, &mut progress)
        .map_err(|e| format!("flash write failed: {e}"))?;

    log::info!("native flash: completed on {port_path}");
    Ok(())
}
