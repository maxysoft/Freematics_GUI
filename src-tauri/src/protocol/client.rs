use crate::protocol::commands::{parse_response, CMD_CFG_DUMP, CMD_CFG_SAVE, RESPONSE_OK};
use crate::protocol::types::DeviceConfig;
use crate::usb::serial_port::SerialPortOps;
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::time::{Duration, Instant};

const READ_TIMEOUT: Duration = Duration::from_secs(2);
/// Wall-clock budget to find a definitive OK/ERR reply for one command attempt,
/// reading past any interleaved async telemetry from the shared UART. Generous
/// so we ride over a busy telemetry/cellular cycle during which the firmware
/// isn't servicing serial.
const CMD_DEADLINE: Duration = Duration::from_secs(8);
/// How many times to (re)send a command that expects OK/ERR before giving up.
/// Rides over windows where the firmware is busy in its telemetry loop and does
/// not service the serial line in time.
const CMD_ATTEMPTS: u32 = 3;
const DUMP_TERMINATOR: &str = "END";
/// How many times to (re)send CFG_DUMP before giving up — rides out the
/// ESP32 reboot that the USB-serial DTR/RTS toggle triggers on port open.
const DUMP_ATTEMPTS: u32 = 3;
const DUMP_RETRY_DELAY: Duration = Duration::from_millis(400);

/// Redact secret values before a serial command is written to the log.
/// `wpwd=hunter2` becomes `wpwd=***`. Only affects logging, not the wire.
fn redact(cmd: &str) -> String {
    if let Some((key, _)) = cmd.split_once('=') {
        if matches!(key, "wpwd" | "ap_pwd" | "apn_pass" | "sim_pin") {
            return format!("{key}=***");
        }
    }
    cmd.to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveData {
    pub battery_v: f32,
    pub rssi: i32,
    pub vin: String,
    pub lat: f64,
    pub lng: f64,
    pub alt: f32,
    pub sat: i32,
    pub spd: f32,
    pub crs: f32,
    pub uptime_ms: u64,
    pub net_op: String,
    pub net_ip: String,
}

impl Default for LiveData {
    fn default() -> Self {
        Self {
            battery_v: 0.0,
            rssi: 0,
            vin: String::new(),
            lat: 0.0,
            lng: 0.0,
            alt: 0.0,
            sat: 0,
            spd: 0.0,
            crs: 0.0,
            uptime_ms: 0,
            net_op: String::new(),
            net_ip: String::new(),
        }
    }
}

pub struct SerialClient<P: SerialPortOps> {
    port: P,
}

impl<P: SerialPortOps> SerialClient<P> {
    pub fn new(port: P) -> Self {
        Self { port }
    }

    /// Test-only accessor for the underlying port's write buffer contents.
    #[cfg(test)]
    pub fn port_ref(&self) -> &P {
        &self.port
    }

    /// Test-only mutable accessor for the underlying port.
    #[cfg(test)]
    pub fn port_mut(&mut self) -> &mut P {
        &mut self.port
    }

    pub fn send(&mut self, cmd: &str) -> io::Result<String> {
        self.send_inner(cmd, false)
    }

    /// Like `send` but logs failures at debug, not warn. Used for best-effort
    /// live-data polling where a no-response (e.g. no OBD link) is expected and
    /// should not spam the log.
    pub fn send_quiet(&mut self, cmd: &str) -> io::Result<String> {
        self.send_inner(cmd, true)
    }

    fn send_inner(&mut self, cmd: &str, quiet: bool) -> io::Result<String> {
        self.port.set_timeout(READ_TIMEOUT)?;
        // Drop stale async telemetry the firmware printed before this command so
        // it can't be mistaken for our reply (e.g. "[BUF] ... samples", "3.7").
        let _ = self.port.clear_input();
        log::debug!("serial TX: {:?}", redact(cmd));
        self.port.write_all(cmd.as_bytes())?;
        // Firmware reads a full line via readStringUntil('\n'), so commands must
        // be terminated with a newline (CRLF for good measure).
        self.port.write_all(b"\r\n")?;
        self.port.flush()?;
        let resp = self.read_line();
        match &resp {
            Ok(line) => log::debug!("serial RX: {line:?}"),
            Err(e) if quiet => log::debug!("serial RX (quiet) after TX {:?}: {e}", redact(cmd)),
            Err(e) => log::warn!("serial RX failed after TX {:?}: {e}", redact(cmd)),
        }
        resp
    }

    fn read_line(&mut self) -> io::Result<String> {
        let mut out = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            match self.port.read(&mut byte) {
                Ok(0) => {
                    if out.is_empty() {
                        return Err(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "no response from device",
                        ));
                    }
                    break;
                }
                Ok(_) => {
                    if byte[0] == b'\r' || byte[0] == b'\n' {
                        if !out.is_empty() {
                            break;
                        }
                        continue;
                    }
                    out.push(byte[0]);
                }
                // A read timeout surfaces as `Ok(0)` on some platforms (Linux)
                // and as `TimedOut`/`WouldBlock` on others (Windows). Treat it
                // uniformly as end-of-data: return the partial line if any, else
                // signal "no response" so callers can retry/stop cleanly.
                Err(e)
                    if e.kind() == io::ErrorKind::TimedOut
                        || e.kind() == io::ErrorKind::WouldBlock =>
                {
                    if out.is_empty() {
                        return Err(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "no response from device",
                        ));
                    }
                    break;
                }
                Err(e) => return Err(e),
            }
        }
        String::from_utf8(out).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    pub fn query(&mut self, key: &str) -> io::Result<String> {
        let cmd = format!("{key}?");
        let raw = self.send(&cmd)?;
        parse_response(&raw)
    }

    /// Read lines until one matches `is_match`, the device falls silent (read
    /// timeout / EOF), or `deadline` passes. Returns the matched line, or `None`
    /// if no match was found this round. Non-matching lines are the firmware's
    /// async telemetry sharing the UART — logged at debug and skipped.
    fn read_until(
        &mut self,
        deadline: Instant,
        is_match: impl Fn(&str) -> bool,
    ) -> io::Result<Option<String>> {
        // Bounds an unbounded chatter stream and, importantly, keeps a test mock
        // (whose reads return instantly) from spinning until the wall-clock
        // deadline. On real hardware each read_line blocks up to READ_TIMEOUT, so
        // the deadline is the effective bound and this cap is never approached.
        const MAX_READS: u32 = 512;
        let mut reads = 0u32;
        loop {
            if reads >= MAX_READS || Instant::now() >= deadline {
                return Ok(None);
            }
            reads += 1;
            match self.read_line() {
                Ok(line) => {
                    let t = line.trim();
                    if is_match(t) {
                        return Ok(Some(t.to_string()));
                    }
                    log::debug!("serial RX (chatter, skipped): {t:?}");
                }
                // A read timeout (no data this window) is NOT the end: the
                // firmware may be busy in its telemetry/cellular cycle and answer
                // shortly. Keep reading until the deadline rather than giving up
                // on the first silent gap.
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {}
                Err(e) => return Err(e),
            }
        }
    }

    /// Send a command that must be acknowledged with `OK` (or rejected with
    /// `ERR`/`ERROR`), tolerating interleaved telemetry and retrying over busy
    /// windows. An explicit `ERR` is final (no retry); silence is retried.
    fn command_expect_ok(&mut self, cmd: &str) -> io::Result<()> {
        let mut last: Option<io::Error> = None;
        for attempt in 1..=CMD_ATTEMPTS {
            self.port.set_timeout(READ_TIMEOUT)?;
            let _ = self.port.clear_input();
            log::debug!(
                "serial TX (attempt {attempt}/{CMD_ATTEMPTS}): {:?}",
                redact(cmd)
            );
            self.port.write_all(cmd.as_bytes())?;
            self.port.write_all(b"\r\n")?;
            self.port.flush()?;

            let deadline = Instant::now() + CMD_DEADLINE;
            let matched = self.read_until(deadline, |t| {
                t.eq_ignore_ascii_case(RESPONSE_OK)
                    || t.eq_ignore_ascii_case("ERR")
                    || t.eq_ignore_ascii_case("ERROR")
            })?;
            match matched {
                Some(resp) if resp.eq_ignore_ascii_case(RESPONSE_OK) => return Ok(()),
                Some(resp) => {
                    // Device understood the command and rejected it — retrying
                    // the same command won't change the verdict.
                    return Err(io::Error::other(format!(
                        "device rejected command {:?} ({resp})",
                        redact(cmd)
                    )));
                }
                None => {
                    log::warn!(
                        "no OK/ERR for {:?} within {CMD_DEADLINE:?} (attempt {attempt}/{CMD_ATTEMPTS})",
                        redact(cmd)
                    );
                    last = Some(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "no response from device",
                    ));
                }
            }
        }
        Err(last.unwrap_or_else(|| {
            io::Error::new(io::ErrorKind::TimedOut, "no response from device")
        }))
    }

    pub fn set(&mut self, key: &str, val: &str) -> io::Result<()> {
        // Firmware's generic setter is `CFG=key=val` (only apn/ssid/wpwd have a
        // bare-key legacy form); prefix everything so all fields are accepted.
        self.command_expect_ok(&format!("CFG={key}={val}"))
    }

    /// Restart the device (`REBOOT`) so freshly saved config takes effect.
    /// The firmware prints `OK` and resets ~100ms later; if the reset wins the
    /// race and the ack is never read, treat silence as success — the restart
    /// is exactly what was asked for.
    pub fn reboot(&mut self) -> io::Result<()> {
        self.port.set_timeout(READ_TIMEOUT)?;
        let _ = self.port.clear_input();
        log::debug!("serial TX: \"REBOOT\"");
        self.port.write_all(b"REBOOT\r\n")?;
        self.port.flush()?;
        let deadline = Instant::now() + Duration::from_secs(2);
        match self.read_until(deadline, |t| t.eq_ignore_ascii_case(RESPONSE_OK)) {
            Ok(Some(_)) => Ok(()),
            // No ack or the port died mid-reset — the device is rebooting.
            Ok(None) | Err(_) => Ok(()),
        }
    }

    pub fn dump_config(&mut self) -> io::Result<DeviceConfig> {
        self.port.set_timeout(READ_TIMEOUT)?;
        // Clear any async telemetry queued before the dump so the reply isn't
        // polluted; only `key=value` lines are kept by from_dump_lines anyway,
        // but draining keeps the per-attempt read windows clean.
        let _ = self.port.clear_input();

        // Opening the port can reset the ESP32 (CH340 auto-reset). Retry the
        // dump a few times so a still-booting device gets caught instead of
        // failing on the first 2s window.
        let mut lines: Vec<String> = Vec::new();
        let mut got_terminator = false;
        for attempt in 1..=DUMP_ATTEMPTS {
            log::debug!("config dump attempt {attempt}/{DUMP_ATTEMPTS} via {CMD_CFG_DUMP}");
            self.port.write_all(CMD_CFG_DUMP.as_bytes())?;
            self.port.write_all(b"\r\n")?;
            self.port.flush()?;

            lines.clear();
            got_terminator = false;
            loop {
                match self.read_line() {
                    Ok(line) => {
                        let trimmed = line.trim();
                        // Firmware ends a CFG_DUMP reply with "OK" (it has no
                        // "END" terminator); accept either.
                        if trimmed == DUMP_TERMINATOR || trimmed == RESPONSE_OK {
                            got_terminator = true;
                            break;
                        }
                        if trimmed.is_empty() {
                            continue;
                        }
                        lines.push(line);
                    }
                    Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
                    Err(e) => {
                        log::error!("config dump read error: {e}");
                        return Err(e);
                    }
                }
            }

            if !lines.is_empty() || got_terminator {
                // Individual lines are NOT logged — they contain secrets
                // (wifi/apn passwords, sim pin). Only the count is recorded.
                log::info!("config dump produced {} line(s) on attempt {attempt}", lines.len());
                break;
            }
            log::warn!("config dump attempt {attempt} got no response; device may still be booting");
            if attempt < DUMP_ATTEMPTS {
                std::thread::sleep(DUMP_RETRY_DELAY);
            }
        }

        if lines.is_empty() && !got_terminator {
            log::error!("device did not respond to {CMD_CFG_DUMP} after {DUMP_ATTEMPTS} attempts");
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!(
                    "device did not respond to {CMD_CFG_DUMP} after {DUMP_ATTEMPTS} attempts — \
                     check the patched firmware is flashed, the baud rate, and that no other \
                     program is holding the port"
                ),
            ));
        }

        DeviceConfig::from_dump_lines(&lines).map_err(|e| {
            log::error!("failed to parse config dump ({} lines): {e}", lines.len());
            io::Error::new(io::ErrorKind::InvalidData, e)
        })
    }

    pub fn save_config(&mut self) -> io::Result<()> {
        self.command_expect_ok(CMD_CFG_SAVE)
    }

    pub fn get_live_data(&mut self) -> io::Result<LiveData> {
        // Best-effort: the telelogger firmware shares this serial line and prints
        // its own async status (e.g. "[CELL] Activating..."), and a field may
        // simply have no reading (no OBD link -> BATT times out). So every field
        // is read independently and tolerantly — a miss yields the default, never
        // an error that would abort the whole poll and trigger a retry storm.
        // The FIRST field that does not respond (timeout) short-circuits and
        // returns the partial result, so an idle/unresponsive device costs ~one
        // 2s timeout per poll rather than ~24s (12 fields × 2s) holding the port.
        let mut d = LiveData::default();
        d.battery_v = match self.live_num("BATT") { Some(v) => v, None => return Ok(d) };
        d.rssi = match self.live_num("RSSI") { Some(v) => v, None => return Ok(d) };
        d.vin = match self.live_str("VIN") { Some(v) => v, None => return Ok(d) };
        d.lat = match self.live_num("LAT") { Some(v) => v, None => return Ok(d) };
        d.lng = match self.live_num("LNG") { Some(v) => v, None => return Ok(d) };
        d.alt = match self.live_num("ALT") { Some(v) => v, None => return Ok(d) };
        d.sat = match self.live_num("SAT") { Some(v) => v, None => return Ok(d) };
        d.spd = match self.live_num("SPD") { Some(v) => v, None => return Ok(d) };
        d.crs = match self.live_num("CRS") { Some(v) => v, None => return Ok(d) };
        d.uptime_ms = match self.live_num("UPTIME") { Some(v) => v, None => return Ok(d) };
        d.net_op = match self.live_str("NET_OP") { Some(v) => v, None => return Ok(d) };
        d.net_ip = match self.live_str("NET_IP") { Some(v) => v, None => return Ok(d) };
        Ok(d)
    }

    // Live-data queries use the bare key (e.g. "BATT"), NOT "BATT?" — the
    // firmware's live handler matches the bare token. A failed *send* (I/O
    // error, timeout) propagates so a disconnected device surfaces as an error.
    // An unparseable *value* (the patched firmware returns "N/A" for live fields
    // with no reading yet) falls back to the type default instead of aborting
    // the whole live-data poll.
    /// Read a live string field. `None` = no response (caller short-circuits
    /// the poll); `Some("")` = responded but empty / "N/A" / firmware chatter.
    fn live_str(&mut self, key: &str) -> Option<String> {
        match self.send_quiet(key) {
            Ok(v) => {
                let t = v.trim();
                if t == "N/A" || is_status_noise(t) {
                    Some(String::new())
                } else {
                    Some(t.to_string())
                }
            }
            Err(_) => None,
        }
    }

    /// Read a numeric live field. `None` = no response (caller short-circuits);
    /// otherwise the parsed value, or the type default for garbage / chatter.
    fn live_num<T: std::str::FromStr + Default>(&mut self, key: &str) -> Option<T> {
        match self.send_quiet(key) {
            Ok(v) => {
                let t = v.trim();
                if is_status_noise(t) {
                    Some(T::default())
                } else {
                    Some(t.parse::<T>().unwrap_or_default())
                }
            }
            Err(_) => None,
        }
    }
}

/// Heuristic: is this serial line the firmware's own async status print rather
/// than a clean answer to our query? (e.g. "[CELL] Activating...", "IP:...").
fn is_status_noise(s: &str) -> bool {
    s.is_empty()
        || s.starts_with('[')
        || s.contains(':')
        || s.contains("...")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::io::Cursor;

    struct MockPort {
        read_buf: Cursor<Vec<u8>>,
        write_buf: Vec<u8>,
        responses: VecDeque<Vec<u8>>,
        timeout_set: bool,
    }

    impl MockPort {
        fn new(responses: Vec<Vec<u8>>) -> Self {
            let initial = responses.first().cloned().unwrap_or_default();
            Self {
                read_buf: Cursor::new(initial),
                write_buf: Vec::new(),
                responses: responses.into_iter().skip(1).collect(),
                timeout_set: false,
            }
        }

        fn write_buf(&self) -> &[u8] {
            &self.write_buf
        }
    }

    impl Read for MockPort {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let n = self.read_buf.read(buf)?;
            if n == 0 {
                if let Some(next) = self.responses.pop_front() {
                    self.read_buf = Cursor::new(next);
                    return self.read_buf.read(buf);
                }
            }
            Ok(n)
        }
    }

    impl Write for MockPort {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.write_buf.extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl SerialPortOps for MockPort {
        fn set_timeout(&mut self, _timeout: Duration) -> io::Result<()> {
            self.timeout_set = true;
            Ok(())
        }
    }

    #[test]
    fn sends_query_terminates_with_cr() {
        let mut client = SerialClient::new(MockPort::new(vec![b"OK\r".to_vec()]));
        let _ = client.send("APN?");
        let mock = client.port_ref();
        assert!(mock.write_buf().ends_with(b"\r\n"));
        assert!(mock.write_buf().windows(4).any(|w| w == b"APN?"));
    }

    #[test]
    fn parses_ok_response() {
        let mut client = SerialClient::new(MockPort::new(vec![b"OK\r".to_vec()]));
        let resp = client.send("APN?").unwrap();
        assert_eq!(resp, "OK");
    }

    #[test]
    fn times_out_on_no_response() {
        let mut client = SerialClient::new(MockPort::new(vec![vec![]]));
        let res = client.send("APN?");
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().kind(), io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn handles_err_response() {
        let mut client = SerialClient::new(MockPort::new(vec![b"ERR\r".to_vec()]));
        let res = client.set("APN", "internet");
        assert!(res.is_err());
    }

    #[test]
    fn escapes_values_in_set() {
        let mut client = SerialClient::new(MockPort::new(vec![b"OK\r".to_vec()]));
        let _ = client.set("SSID", "my wifi network");
        let mock = client.port_ref();
        // Sets are sent as CFG=key=val terminated by CRLF.
        let expected = b"CFG=SSID=my wifi network\r\n";
        assert!(mock.write_buf().windows(expected.len()).any(|w| w == expected));
    }

    #[test]
    fn set_skips_async_chatter_then_accepts_ok() {
        // The shared UART interleaves telemetry ("[BUF] ...", a stray "3.7")
        // before the real "OK"; set() must skip past it, not fail on it.
        let resp = b"[BUF] 78 samples | 780 bytes | 26/32\r3.7\rOK\r".to_vec();
        let mut client = SerialClient::new(MockPort::new(vec![resp]));
        client.set("apn", "internet.it").expect("set should skip chatter and see OK");
        let mock = client.port_ref();
        let expected = b"CFG=apn=internet.it\r\n";
        assert!(mock.write_buf().windows(expected.len()).any(|w| w == expected));
    }

    #[test]
    fn set_reports_device_rejection_after_chatter() {
        let resp = b"[CELL] activating...\rERR\r".to_vec();
        let mut client = SerialClient::new(MockPort::new(vec![resp]));
        let err = client.set("apn", "x").unwrap_err();
        assert!(err.to_string().contains("rejected"), "got: {err}");
    }

    #[test]
    fn set_times_out_when_only_chatter() {
        // Never any OK/ERR — only telemetry. set() retries then fails cleanly
        // (TimedOut), not "unexpected response: <chatter>".
        let resp = b"[BUF] 1 samples | 2 bytes | 0/8\rmore noise\r".to_vec();
        let mut client = SerialClient::new(MockPort::new(vec![resp]));
        let err = client.set("apn", "x").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn save_config_skips_chatter_then_ok() {
        let resp = b"[BUF] 5 samples | 50 bytes | 1/8\rOK\r".to_vec();
        let mut client = SerialClient::new(MockPort::new(vec![resp]));
        assert!(client.save_config().is_ok());
    }

    #[test]
    fn cfg_dump_parses_full_config() {
        let dump = b"apn=internet\rssid=home\rwpwd=secret\rsrv_host=hub.freematics.com\rsrv_port=8081\rsrv_proto=udp\rsrv_path=/push\rgnss=standalone\rstorage=none\robd=1\rmems=1\rwifi=0\rble=0\rhttpd=0\rsim_pin=\rapn_user=\rapn_pass=\rap_ssid=Freematics\rap_pwd=\rmotion_thr=0.4\rjumpstart_v=14500\rcooling_temp=80\rgnss_always_on=0\rgnss_reset_to=0\rmax_obd_err=5\rsync_interval=30\rping_interval=0\rpsram=0\rEND\r".to_vec();
        let mut client = SerialClient::new(MockPort::new(vec![dump]));
        let cfg = client.dump_config().unwrap();
        assert_eq!(cfg.cell_apn, "internet");
        assert_eq!(cfg.wifi_ssid, "home");
        assert_eq!(cfg.wifi_password, "secret");
        assert_eq!(cfg.server_host, "hub.freematics.com");
        assert_eq!(cfg.server_port, 8081);
        assert!(cfg.enable_obd);
        assert!(!cfg.enable_wifi);
    }

    #[test]
    fn cfg_set_round_trips() {
        let mut cfg = DeviceConfig::default();
        cfg.cell_apn = "internet".to_string();
        cfg.wifi_ssid = "home".to_string();
        cfg.server_port = 8081;
        cfg.enable_wifi = true;

        let set_cmds = cfg.to_set_commands();
        let mut responses: Vec<Vec<u8>> = set_cmds
            .iter()
            .map(|_| b"OK\r".to_vec())
            .collect();
        let dump_lines: Vec<u8> = set_cmds
            .iter()
            .flat_map(|(k, v)| format!("{k}={v}\r").into_bytes())
            .chain(b"END\r".to_vec())
            .collect();
        responses.push(dump_lines);

        let mut client = SerialClient::new(MockPort::new(responses));
        for (key, val) in &set_cmds {
            client.set(key, val).expect("set should succeed");
        }
        let parsed = client.dump_config().unwrap();
        assert_eq!(parsed.cell_apn, "internet");
        assert_eq!(parsed.wifi_ssid, "home");
        assert_eq!(parsed.server_port, 8081);
        assert!(parsed.enable_wifi);
    }

    #[test]
    fn save_config_returns_ok() {
        let mut client = SerialClient::new(MockPort::new(vec![b"OK\r".to_vec()]));
        assert!(client.save_config().is_ok());
    }

    #[test]
    fn get_live_data_parses_all_fields() {
        let responses: Vec<Vec<u8>> = vec![
            b"12.4\r".to_vec(),
            b"-65\r".to_vec(),
            b"14.2\r".to_vec(),
            b"37.7749\r".to_vec(),
            b"-122.4194\r".to_vec(),
            b"10.5\r".to_vec(),
            b"12\r".to_vec(),
            b"55.5\r".to_vec(),
            b"180.0\r".to_vec(),
            b"3600000\r".to_vec(),
            b"T-Mobile\r".to_vec(),
            b"10.0.0.1\r".to_vec(),
        ];
        let mut client = SerialClient::new(MockPort::new(responses));
        let data = client.get_live_data().unwrap();
        assert!((data.battery_v - 12.4).abs() < 1e-6);
        assert_eq!(data.rssi, -65);
        assert_eq!(data.vin, "14.2");
        assert!((data.lat - 37.7749).abs() < 1e-6);
        assert!((data.lng - -122.4194).abs() < 1e-6);
        assert_eq!(data.sat, 12);
        assert_eq!(data.uptime_ms, 3600000);
        assert_eq!(data.net_op, "T-Mobile");
        assert_eq!(data.net_ip, "10.0.0.1");
    }
}
