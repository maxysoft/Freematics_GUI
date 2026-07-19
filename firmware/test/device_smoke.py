#!/usr/bin/env python3
"""On-device smoke test for the patched telelogger serial config protocol.

Runs inside the firmware container with the device passed through:

  docker compose -f docker-compose.yml -f docker-compose.device.yml \
    run --rm firmware python3 test/device_smoke.py [--port /dev/ttyUSB0] \
    [--set key=val ...] [--save] [--reboot] [--expect key=val ...]

Exit code 0 = all steps OK. Prints a transcript. Tolerates telemetry chatter
on the shared UART by reading past non-matching lines up to a deadline
(mirrors the app's read_until behavior).
"""

import argparse
import sys
import time

import serial

CHATTER_DEADLINE = 8.0  # seconds to wait for a matching reply
LIVE_KEYS = [
    "BATT", "RSSI", "VIN", "LAT", "LNG", "ALT",
    "SAT", "SPD", "CRS", "UPTIME", "NET_OP", "NET_IP",
]


def open_port(path: str) -> serial.Serial:
    s = serial.Serial()
    s.port = path
    s.baudrate = 115200
    s.timeout = 0.25
    # Deassert before open so the CH340 auto-reset circuit (DTR->GPIO0,
    # RTS->EN) doesn't put the ESP32 into the bootloader.
    s.dtr = False
    s.rts = False
    s.open()
    return s


def drain(s: serial.Serial, quiet: float = 0.3) -> None:
    """Discard buffered chatter until the line goes quiet for `quiet` s."""
    last = time.monotonic()
    while time.monotonic() - last < quiet:
        n = s.in_waiting
        if n:
            s.read(n)
            last = time.monotonic()
        else:
            time.sleep(0.02)


def read_until(s: serial.Serial, match, deadline: float) -> str | None:
    """Read lines, skipping chatter, until `match(line)` or deadline."""
    end = time.monotonic() + deadline
    buf = b""
    while time.monotonic() < end:
        chunk = s.read(256)
        if not chunk:
            continue
        buf += chunk
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            if match(line):
                return line
            print(f"    (chatter) {line}")
    return None


def command(s: serial.Serial, cmd: str, match, deadline=CHATTER_DEADLINE):
    drain(s)
    s.write((cmd + "\r\n").encode())
    s.flush()
    return read_until(s, match, deadline)


def cfg_dump(s: serial.Serial) -> dict[str, str]:
    """CFG_DUMP -> dict. Collect key=value lines until OK."""
    drain(s)
    s.write(b"CFG_DUMP\r\n")
    s.flush()
    end = time.monotonic() + CHATTER_DEADLINE
    kv: dict[str, str] = {}
    buf = b""
    while time.monotonic() < end:
        chunk = s.read(256)
        if not chunk:
            continue
        buf += chunk
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            line = raw.decode(errors="replace").strip()
            if line == "OK":
                return kv
            if "=" in line and " " not in line.split("=", 1)[0]:
                k, v = line.split("=", 1)
                kv[k] = v
    raise TimeoutError(f"CFG_DUMP incomplete ({len(kv)} keys, no OK)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="/dev/ttyUSB0")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VAL")
    ap.add_argument("--save", action="store_true")
    ap.add_argument("--reboot", action="store_true")
    ap.add_argument("--expect", action="append", default=[], metavar="KEY=VAL",
                    help="verify a CFG_DUMP value at the end")
    ap.add_argument("--live", action="store_true", help="query live keys")
    args = ap.parse_args()

    s = open_port(args.port)
    print(f"== port {args.port} open, settling…")
    time.sleep(1.0)
    fails = 0

    # Port open can reset the ESP32 (CH340 auto-reset). Boot + cell init takes
    # up to ~30s during which loop()/processSerial doesn't run — retry.
    print("== CFG_DUMP")
    kv = {}
    for attempt in range(5):
        try:
            kv = cfg_dump(s)
            break
        except TimeoutError as e:
            print(f"   attempt {attempt + 1}: {e}; retrying…")
            time.sleep(5.0)
    if kv:
        print(f"   {len(kv)} keys")
        for k, v in sorted(kv.items()):
            print(f"   {k}={v}")
    else:
        print("   FAIL: no CFG_DUMP after retries")
        fails += 1

    for pair in args.set:
        key = pair.split("=", 1)[0]
        print(f"== CFG={pair}")
        r = command(s, f"CFG={pair}", lambda l: l in ("OK", "ERR"))
        print(f"   -> {r}")
        if r != "OK":
            fails += 1

    if args.save:
        print("== CFG_SAVE")
        r = command(s, "CFG_SAVE", lambda l: l in ("OK", "ERR"))
        print(f"   -> {r}")
        if r != "OK":
            fails += 1

    if args.live:
        for k in LIVE_KEYS:
            r = command(s, k, lambda l: not l.startswith("["), deadline=4.0)
            print(f"   {k} = {r}")

    if args.reboot:
        print("== REBOOT")
        s.write(b"REBOOT\r\n")
        s.flush()
        time.sleep(4.0)
        drain(s, quiet=0.5)
        print("   (rebooted, settling)")

    if args.expect:
        print("== verify after (re)load")
        kv = cfg_dump(s)
        for pair in args.expect:
            k, v = pair.split("=", 1)
            got = kv.get(k)
            ok = got == v
            print(f"   {k}: expect {v!r} got {got!r} {'OK' if ok else 'FAIL'}")
            if not ok:
                fails += 1

    s.close()
    print(f"== done, {fails} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
