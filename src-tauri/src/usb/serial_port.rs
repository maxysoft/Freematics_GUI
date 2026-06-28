use std::io::{self, Read, Write};
use std::time::Duration;

const BAUD_RATE: u32 = 115_200;
const READ_TIMEOUT: Duration = Duration::from_secs(2);

pub trait SerialPortOps: Read + Write + Send {
    fn set_timeout(&mut self, timeout: Duration) -> io::Result<()>;
}

pub struct RealSerialPort {
    inner: Box<dyn serialport::SerialPort>,
}

impl RealSerialPort {
    pub fn open(port_path: &str) -> io::Result<Self> {
        let inner = serialport::new(port_path, BAUD_RATE)
            .timeout(READ_TIMEOUT)
            .open()
            .map_err(|e| io::Error::other(e.to_string()))?;
        Ok(Self { inner })
    }
}

impl Read for RealSerialPort {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buf)
    }
}

impl Write for RealSerialPort {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.inner.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

impl SerialPortOps for RealSerialPort {
    fn set_timeout(&mut self, timeout: Duration) -> io::Result<()> {
        self.inner
            .set_timeout(timeout)
            .map_err(|e| io::Error::other(e.to_string()))
    }
}

pub struct SerialPortHandle<P: SerialPortOps> {
    port: P,
}

impl<P: SerialPortOps> SerialPortHandle<P> {
    pub fn new(port: P) -> Self {
        Self { port }
    }

    /// Test-only accessor for the underlying port.
    #[cfg(test)]
    pub fn port_ref(&self) -> &P {
        &self.port
    }

    pub fn open(port_path: &str) -> io::Result<SerialPortHandle<RealSerialPort>> {
        let port = RealSerialPort::open(port_path)?;
        Ok(SerialPortHandle::new(port))
    }

    pub fn write_line(&mut self, line: &str) -> io::Result<()> {
        self.port.write_all(line.as_bytes())?;
        self.port.write_all(b"\r")?;
        self.port.flush()
    }

    pub fn read_line(&mut self) -> io::Result<String> {
        let mut out = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            match self.port.read(&mut byte) {
                Ok(0) => return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "port closed")),
                Ok(_) => {
                    if byte[0] == b'\r' || byte[0] == b'\n' {
                        if !out.is_empty() {
                            break;
                        }
                        continue;
                    }
                    out.push(byte[0]);
                }
                Err(e) => return Err(e),
            }
        }
        String::from_utf8(out).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    struct MockSerialPort {
        read_buf: Cursor<Vec<u8>>,
        write_buf: Vec<u8>,
        timeout_set: bool,
    }

    impl MockSerialPort {
        fn new(read_data: Vec<u8>) -> Self {
            Self {
                read_buf: Cursor::new(read_data),
                write_buf: Vec::new(),
                timeout_set: false,
            }
        }
    }

    impl Read for MockSerialPort {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            self.read_buf.read(buf)
        }
    }

    impl Write for MockSerialPort {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.write_buf.extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl SerialPortOps for MockSerialPort {
        fn set_timeout(&mut self, _timeout: Duration) -> io::Result<()> {
            self.timeout_set = true;
            Ok(())
        }
    }

    #[test]
    fn write_line_appends_cr() {
        let mut handle = SerialPortHandle::new(MockSerialPort::new(vec![]));
        handle.write_line("APN?").unwrap();
        let mock = handle.port_ref();
        assert_eq!(mock.write_buf, b"APN?\r");
    }

    #[test]
    fn read_line_strips_terminator() {
        let mut handle = SerialPortHandle::new(MockSerialPort::new(b"OK\r".to_vec()));
        let line = handle.read_line().unwrap();
        assert_eq!(line, "OK");
    }

    #[test]
    fn read_line_handles_multiline_until_first_cr() {
        let mut handle =
            SerialPortHandle::new(MockSerialPort::new(b"line1\rline2\r".to_vec()));
        let line = handle.read_line().unwrap();
        assert_eq!(line, "line1");
    }
}
