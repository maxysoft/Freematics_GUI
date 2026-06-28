# Freematics Config Manager — User Guide

This guide walks you through installing, connecting, configuring, backing up, and flashing your Freematics ONE+ device. No programming experience required.

## Getting started

The Freematics Config Manager is a **portable** app — there is nothing to install.

### Windows

1. Go to the [Releases](../../releases) page.
2. Download `freematics-config-manager.exe`.
3. Double-click the `.exe` to launch it.

> If Windows SmartScreen warns about an unrecognized app, click **More info → Run anyway**. The app is not code-signed in this release.

### Linux

1. Go to the [Releases](../../releases) page.
2. Download the `.AppImage` file.
3. Make it executable and run it:
   ```bash
   chmod +x Freematics-Config-Manager_*.AppImage
   ./Freematics-Config-Manager_*.AppImage
   ```

> On some distributions you may need to install `libwebkit2gtk-4.1` and `libgtk-3` system packages the first time.

The firmware binary is bundled inside the app, so you do **not** need an internet connection to flash a device.

## Connecting your device

1. Plug the Freematics ONE+ into your computer with a USB cable.
2. Open the Freematics Config Manager.
3. On the **Connect** tab, click **Detect device**.

The app automatically scans for the Freematics ONE+ USB adapter (CH341 chip, vendor `1a86`, product `7523`) and lists matching serial ports. When a device is found, its port path appears (e.g. `COM3` on Windows or `/dev/ttyUSB0` on Linux) and you can click **Connect**.

If no device appears, see [Troubleshooting](#troubleshooting).

## Configuring the device

Once connected, the configuration tabs become available. Each tab maps to a group of device parameters. Edit the fields and click **Save** to write them to the device (the app sends `CFG=` commands and then `CFG_SAVE` to persist to NVS).

### Network

Cellular and Wi-Fi settings:

- **APN** — your mobile carrier's Access Point Name (e.g. `internet`).
- **APN username / password** — leave blank if your carrier doesn't require them.
- **SIM PIN** — only set if your SIM card has a PIN lock enabled.
- **Wi-Fi SSID / password** — for connecting the device to a local Wi-Fi network.
- **Wi-Fi AP SSID / password** — for the device's own hotspot (access point) mode.

### Server

Where the device sends its telemetry:

- **Server host** — hostname or IP of your telemetry server (e.g. `demo.traccar.org`).
- **Server port** — TCP/UDP port (e.g. `5055` for Traccar).
- **Protocol** — `udp`, `https_get`, or `https_post`.
- **Server path** — HTTP path for HTTPS protocols (e.g. `/api/positions`).
- **Sync interval** — how often (seconds) the device uploads data.
- **Ping-back interval** — how often (seconds) the device sends a keepalive.

### Hardware

Device behaviour and sensor toggles:

- **GNSS mode** — `none`, `standalone`, or `cellular` (assisted).
- **Storage** — `none`, `spiffs` (onboard flash), or `sd` (SD card).
- **Enable OBD** — turn on OBD-II vehicle data reading.
- **Enable MEMS** — turn on the motion/orientation sensor.
- **Enable Wi-Fi / BLE / HTTPD** — toggle individual subsystems.
- **Motion threshold** — accelerometer threshold for motion detection.
- **Jump-start voltage** — voltage below which the device enters low-power mode.
- **Cooling-down temp** — engine temperature threshold for cooldown logic.
- **GNSS always-on / reset timeout / max OBD errors / board has PSRAM** — advanced flags.

## Backup & restore

Use the **Backup** tab to save the entire device configuration to a JSON file, or restore it later.

### Export (backup)

1. Connect the device.
2. Click **Export config**.
3. Choose where to save the `.json` file.

The backup file includes every config parameter **and** the SHA256 of the firmware currently on the device, so you can tell later whether the firmware has changed.

### Import (restore)

1. Connect the device.
2. Click **Import config**.
3. Choose a previously exported `.json` file.

The app applies each parameter with `CFG=` commands and then runs `CFG_SAVE`. If the firmware SHA256 in the backup doesn't match the device's current firmware, you'll see a warning — the import still proceeds, but you may want to reflash first.

## Flashing firmware

The **Flash** tab reflashes the device with the patched `telelogger` firmware that exposes the serial command protocol. This is required if your device is running stock firmware.

### Walkthrough

1. Connect the device over USB.
2. Open the **Flash** tab. The app shows the bundled firmware version and SHA256.
3. Click **Flash firmware**.
4. Wait for the progress bar to reach 100%. The device reboots automatically when done.
5. Reconnect on the **Connect** tab and verify with **Detect device**.

> The firmware binary is bundled inside the app (no download needed). Flashing uses `esptool` under the hood over the same USB serial port.

> Do not unplug the device or close the app while flashing is in progress.

## Troubleshooting

### No device detected

- **Check the cable** — use a data USB cable, not a charge-only cable.
- **Check the port** — on Linux, make sure your user is in the `dialout` group: `sudo usermod -aG dialout $USER` then log out and back in. On Windows, check Device Manager for the CH341 port.
- **Try another USB port** — some USB hubs don't pass through the CH341 adapter reliably.
- **Power** — the Freematics ONE+ may need external power; USB alone may not be enough for some revisions.

### Flash failed

- **Port busy** — close any other terminal or app that has the serial port open (Arduino IDE, `screen`, `minicom`, etc.).
- **Boot mode** — hold the device's BOOT button (if available) while flashing starts, then release.
- **Wrong port** — re-detect the device on the Connect tab and confirm the port path matches.
- **Re-run the flash** — transient USB errors sometimes resolve on retry.

### Port busy / permission denied

- **Linux:** ensure your user is in the `dialout` group and no other process holds the port.
- **Windows:** close other serial apps; if a previous flash crashed, unplug and replug the device.

### Config save didn't persist

- The app sends `CFG_SAVE` after writing parameters. If the device was unplugged before the save completed, the new values won't be in NVS. Reconnect and save again.
- If you flashed stock (unpatched) firmware, the `CFG*` commands won't exist — reflash with the patched firmware from the Flash tab.

### App won't start (Linux)

#### Quick checks

- Make sure the `.AppImage` is executable: `chmod +x *.AppImage`.
- On minimal distributions, install the runtime libraries: `sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0` (Debian/Ubuntu) or the equivalent for your distro.

#### "Could not create default EGL display: EGL_BAD_PARAMETER. Aborting..."

This is the most common Linux startup failure. It means WebKit2GTK (the rendering engine) could not initialize EGL. EGL requires a working **DRI render node** (`/dev/dri/renderD128`), not just a working GLX setup.

**Check whether you have a render node:**

```bash
ls /dev/dri/
```

You should see at least `card0` **and** `renderD128`. If only `card0` is present, EGL cannot initialize and the app will abort.

**On a physical machine (real GPU):** this usually means the DRI driver for your GPU is missing or misconfigured. Install the appropriate Mesa DRI driver for your hardware (e.g. `mesa-vulkan-drivers`, `libgl1-mesa-dri`, or your vendor driver).

**On a virtual machine (VirtualBox, VMware, QEMU):** see the [Virtual machine setup](#virtual-machine-setup) section below — VMs need specific graphics configuration to expose a render node.

#### "Failed to load module xapp-gtk3-module"

This is a harmless warning. It means an optional GTK module (provided by the `xapp` package on Cinnamon/MATE desktops) is not installed. The app works fine without it. You can ignore this message.

### Virtual machine setup

The Freematics Config Manager uses WebKit2GTK, which requires EGL with a DRI render node. Virtual machines need specific graphics configuration to provide this.

#### VirtualBox

VirtualBox's default `vboxvideo` graphics driver only exposes a KMS display node (`/dev/dri/card0`) — **no render node** (`renderD128`). EGL cannot initialize, so the app aborts with `EGL_BAD_PARAMETER`.

**To fix, enable 3D acceleration:**

1. Shut down the VM.
2. VirtualBox Manager → select the VM → **Settings → Display**.
3. Set **Graphics Controller** to **VMSVGA** (the default for Linux guests).
4. Check **Enable 3D Acceleration**.
5. Start the VM.

After boot, verify the render node exists:

```bash
ls /dev/dri/
# Should show: card0  renderD128
```

If `renderD128` is present, the app will run.

**If the VM hangs on the boot splash (Plymouth) after enabling 3D acceleration:**

This is a known conflict between Plymouth (the animated boot screen) and VirtualBox's VMSVGA 3D driver. Plymouth tries to use the 3D path and deadlocks before the display manager starts. The boot log will show it stalling at:

```
Starting Hold until boot process finishes up...
Starting Terminate Plymouth Boot Screen...
```

…and never reaching the login screen. **The fix is to disable Plymouth:**

1. Boot the VM in recovery mode (or from a live USB if it won't boot at all).
2. Edit the kernel command line to disable Plymouth. Append `plymouth.enable=0` to `GRUB_CMDLINE_LINUX_DEFAULT` in `/etc/default/grub`:
   ```bash
   sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 plymouth.enable=0"/' /etc/default/grub
   sudo grub-mkconfig -o /boot/grub/grub.cfg
   ```
   (On Arch/Manjaro, the file may be `/etc/default/grub` with `grub-mkconfig -o /boot/grub/grub.cfg`.)
3. Alternatively, mask the Plymouth units entirely:
   ```bash
   sudo systemctl mask plymouth-start plymouth-quit plymouth-quit-wait
   ```
4. Reboot. The boot will show text output instead of the splash, then proceed to the login screen.
5. Verify the render node: `ls /dev/dri/` should now show `renderD128`.

Once Plymouth is disabled and 3D acceleration is on, the Freematics Config Manager runs normally inside the VM.

#### VMware

VMware's `vmware` SVGA driver typically exposes a render node out of the box. Ensure 3D acceleration is enabled in the VM settings (VM Settings → Display → Accelerate 3D graphics). The app should work without extra configuration.

#### QEMU/KVM

Use the `virtio-gpu` device with `virglrenderer` for 3D acceleration:

```
-device virtio-vga-gl,virgl=true
```

Or use `-display gtk,gl=on`. Verify `renderD128` exists after boot.

### Still stuck

Open an issue on the [GitHub repository](../../issues) with:

- Your operating system and version.
- Whether you are running on a physical machine or a VM (and which VM software).
- The output of `ls /dev/dri/` and `glxinfo | grep renderer`.
- The device model and firmware version (from the Flash tab).
- The exact error message or screenshot.
