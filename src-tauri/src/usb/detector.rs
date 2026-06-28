use serde::Serialize;

const CH341_VENDOR_ID: u16 = 0x1a86;
const CH341_PRODUCT_ID: u16 = 0x7523;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DeviceInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: String,
    pub manufacturer: String,
    pub port_path: String,
}

pub trait UsbEnumerator {
    fn list(&self) -> Vec<RawUsbDevice>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawUsbDevice {
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: Option<String>,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
}

pub struct NusbEnumerator;

impl UsbEnumerator for NusbEnumerator {
    fn list(&self) -> Vec<RawUsbDevice> {
        match nusb::list_devices() {
            Ok(iter) => iter
                .map(|d| RawUsbDevice {
                    vendor_id: d.vendor_id(),
                    product_id: d.product_id(),
                    product_name: d.product_string().map(String::from),
                    manufacturer: d.manufacturer_string().map(String::from),
                    serial_number: d.serial_number().map(String::from),
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    }
}

pub fn detect_devices_with<E: UsbEnumerator>(enumerator: &E) -> Vec<DeviceInfo> {
    // Production path resolves the OS port name via serialport.
    detect_devices_with_resolver(enumerator, resolve_port_path)
}

/// Core detection with an injectable port resolver. Keeping the resolver as a
/// parameter lets unit tests run hermetically — the default `resolve_port_path`
/// calls `serialport::available_ports()`, which is environment-dependent (it
/// only returns a port when the physical device is actually attached).
fn detect_devices_with_resolver<E, F>(enumerator: &E, resolve: F) -> Vec<DeviceInfo>
where
    E: UsbEnumerator,
    F: Fn(&RawUsbDevice) -> Option<String>,
{
    enumerator
        .list()
        .into_iter()
        .filter(|d| d.vendor_id == CH341_VENDOR_ID && d.product_id == CH341_PRODUCT_ID)
        .filter_map(|d| {
            let port_path = resolve(&d)?;
            Some(DeviceInfo {
                vendor_id: d.vendor_id,
                product_id: d.product_id,
                product_name: d.product_name.unwrap_or_else(|| "USB Serial".into()),
                manufacturer: d.manufacturer.unwrap_or_default(),
                port_path,
            })
        })
        .collect()
}

pub fn detect_devices() -> Vec<DeviceInfo> {
    detect_devices_with(&NusbEnumerator)
}

fn resolve_port_path(device: &RawUsbDevice) -> Option<String> {
    let ports = serialport::available_ports().ok()?;
    for p in ports {
        if let serialport::SerialPortType::UsbPort(usb) = &p.port_type {
            if usb.vid == device.vendor_id && usb.pid == device.product_id {
                return Some(p.port_name);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockEnumerator(Vec<RawUsbDevice>);
    impl UsbEnumerator for MockEnumerator {
        fn list(&self) -> Vec<RawUsbDevice> {
            self.0.clone()
        }
    }

    fn ch341() -> RawUsbDevice {
        RawUsbDevice {
            vendor_id: CH341_VENDOR_ID,
            product_id: CH341_PRODUCT_ID,
            product_name: Some("USB Serial".into()),
            manufacturer: Some("QinHeng".into()),
            serial_number: None,
        }
    }

    // Hermetic resolver: never touches the OS / serialport, so detection tests
    // pass regardless of whether a physical device is attached to the host.
    fn fake_resolver(_d: &RawUsbDevice) -> Option<String> {
        Some("COM3".to_string())
    }

    #[test]
    fn detects_ch341_by_vid_pid() {
        let e = MockEnumerator(vec![ch341()]);
        let result = detect_devices_with_resolver(&e, fake_resolver);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].vendor_id, CH341_VENDOR_ID);
        assert_eq!(result[0].product_id, CH341_PRODUCT_ID);
        assert_eq!(result[0].port_path, "COM3");
    }

    #[test]
    fn filters_non_ch341() {
        let other = RawUsbDevice {
            vendor_id: 0x1234,
            product_id: 0x5678,
            product_name: None,
            manufacturer: None,
            serial_number: None,
        };
        let e = MockEnumerator(vec![other, ch341()]);
        let result = detect_devices_with_resolver(&e, fake_resolver);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].vendor_id, CH341_VENDOR_ID);
    }

    #[test]
    fn skips_device_without_resolvable_port() {
        let e = MockEnumerator(vec![ch341()]);
        let result = detect_devices_with_resolver(&e, |_| None);
        assert!(result.is_empty());
    }

    #[test]
    fn handles_no_device() {
        let e = MockEnumerator(vec![]);
        let result = detect_devices_with_resolver(&e, fake_resolver);
        assert!(result.is_empty());
    }
}
