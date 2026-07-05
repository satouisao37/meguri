#!/usr/bin/env python3
import math
import os
import struct
import zlib


def mix(a, b, t):
    return int(round(a + (b - a) * t))


def chunk(handle, name, data):
    handle.write(struct.pack('>I', len(data)))
    handle.write(name)
    handle.write(data)
    handle.write(struct.pack('>I', zlib.crc32(name + data) & 0xffffffff))


def png(path, size):
    bg = (237, 239, 241, 255)
    border = (10, 100, 174, 255)
    line = (0, 137, 163, 255)
    stop = (194, 78, 0, 255)
    text = (21, 24, 27, 255)
    rows = []
    pad = size * 0.14
    points = [
        (pad, size * 0.68),
        (size * 0.38, size * 0.42),
        (size * 0.62, size * 0.57),
        (size - pad, size * 0.31),
    ]
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            color = bg
            if x < size * 0.08 or y < size * 0.08 or x > size * 0.92 or y > size * 0.92:
                color = (214, 217, 220, 255)
            # 折れ線の太さを距離で描く
            dmin = 9999.0
            for i in range(len(points) - 1):
                ax, ay = points[i]
                bx, by = points[i + 1]
                vx = bx - ax
                vy = by - ay
                wx = x - ax
                wy = y - ay
                c = max(0.0, min(1.0, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
                px = ax + vx * c
                py = ay + vy * c
                dmin = min(dmin, math.hypot(x - px, y - py))
            if dmin < size * 0.025:
                color = line
            for px, py in points:
                r = math.hypot(x - px, y - py)
                if r < size * 0.075:
                    color = stop
                if r < size * 0.04:
                    color = bg
            cx = size * 0.5
            cy = size * 0.8
            if abs(x - cx) < size * 0.18 and abs(y - cy) < size * 0.022:
                color = text
            if math.hypot(x - size * 0.5, y - size * 0.5) > size * 0.49:
                t = min(1, (math.hypot(x - size * 0.5, y - size * 0.5) - size * 0.49) / (size * 0.02))
                color = tuple(mix(color[i], border[i], t) for i in range(4))
            row.extend(color)
        rows.append(bytes(row))
    raw = b''.join(rows)
    with open(path, 'wb') as handle:
        handle.write(b'\x89PNG\r\n\x1a\n')
        chunk(handle, b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
        chunk(handle, b'IDAT', zlib.compress(raw, 9))
        chunk(handle, b'IEND', b'')


def main():
    os.makedirs('icons', exist_ok=True)
    png('icons/apple-touch-icon.png', 180)
    png('icons/icon-192.png', 192)
    png('icons/icon-512.png', 512)


if __name__ == '__main__':
    main()
