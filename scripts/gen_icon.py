#!/usr/bin/env python3
"""Generate a 512x512 PNG icon with no external deps (pure stdlib)."""
import struct, zlib

W = H = 512

def make_png(pixels):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)  # 8-bit RGBA
    raw = bytearray()
    for y in range(H):
        raw.append(0)  # filter none
        for px in pixels[y]:
            raw.extend(px)
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

# Dark rounded-rect background with a cyan "F" mark
bg = (30, 30, 34, 255)
accent = (0, 188, 212, 255)
fg = (240, 240, 240, 255)

pixels = [[bg]*W for _ in range(H)]

# rounded rect mask
r = 96
for y in range(H):
    for x in range(W):
        in_x = r if (x < r or x >= W-r) else 0
        in_y = r if (y < r or y >= H-r) else 0
        if in_x and in_y:
            cx = r if x < r else W-1-r
            cy = r if y < r else H-1-r
            if (x-cx)**2 + (y-cy)**2 > r*r:
                pixels[y][x] = (0,0,0,0)

# Draw "F" letter: vertical bar + two horizontal bars
bar_w = 70
# vertical bar
vx0, vx1 = 150, 150+bar_w
for y in range(130, 390):
    for x in range(vx0, vx1):
        if 0 <= x < W and 0 <= y < H:
            pixels[y][x] = fg
# top horizontal bar
for y in range(130, 200):
    for x in range(vx0, 330):
        if 0 <= x < W:
            pixels[y][x] = fg
# middle horizontal bar
for y in range(250, 310):
    for x in range(vx0, 300):
        if 0 <= x < W:
            pixels[y][x] = fg

# accent underline
for y in range(410, 430):
    for x in range(150, 360):
        if 0 <= x < W:
            pixels[y][x] = accent

data = make_png(pixels)
with open("src-tauri/icons/icon.png", "wb") as f:
    f.write(data)
print(f"Wrote {len(data)} bytes to src-tauri/icons/icon.png")
