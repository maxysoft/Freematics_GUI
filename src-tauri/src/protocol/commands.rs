use std::io;

pub const CMD_APN_QUERY: &str = "APN?";
pub const CMD_SSID_QUERY: &str = "SSID?";
pub const CMD_WPWD_QUERY: &str = "WPWD?";

pub const CMD_CFG_DUMP: &str = "CFG_DUMP";
pub const CMD_CFG_SAVE: &str = "CFG_SAVE";
pub const CMD_CFG_LOAD: &str = "CFG_LOAD";

pub const CMD_BATT: &str = "BATT";
pub const CMD_RSSI: &str = "RSSI";
pub const CMD_VIN: &str = "VIN";
pub const CMD_LAT: &str = "LAT";
pub const CMD_LNG: &str = "LNG";
pub const CMD_ALT: &str = "ALT";
pub const CMD_SAT: &str = "SAT";
pub const CMD_SPD: &str = "SPD";
pub const CMD_CRS: &str = "CRS";
pub const CMD_UPTIME: &str = "UPTIME";
pub const CMD_NET_OP: &str = "NET_OP";
pub const CMD_NET_IP: &str = "NET_IP";

pub const RESPONSE_OK: &str = "OK";
pub const RESPONSE_ERR: &str = "ERR";

pub fn build_query(key: &str) -> String {
    format!("{key}?")
}

pub fn build_set(key: &str, val: &str) -> String {
    format!("{key}={val}")
}

pub fn parse_response(raw: &str) -> io::Result<String> {
    let trimmed = raw.trim();
    if trimmed == RESPONSE_ERR {
        return Err(io::Error::other("device returned ERR"));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_query_appends_question_mark() {
        assert_eq!(build_query("APN"), "APN?");
    }

    #[test]
    fn build_set_joins_with_equals() {
        assert_eq!(build_set("APN", "internet"), "APN=internet");
    }

    #[test]
    fn parse_response_ok_strips_whitespace() {
        let r = parse_response("  OK  ").unwrap();
        assert_eq!(r, "OK");
    }

    #[test]
    fn parse_response_err_returns_error() {
        assert!(parse_response("ERR").is_err());
    }
}
