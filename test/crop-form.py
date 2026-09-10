# -*- coding: utf-8 -*-
"""把长截图按纵向切段并放大导出，便于阅读表单文字（纯标准库）"""
import os
import struct
import sys
import zlib

SRC = r'C:\Users\Administrator\.workbuddy\clipboard-images\clipboard-2026-09-10T13-31-51-958Z-b01c1a50.png'
OUT_DIR = sys.argv[1] if len(sys.argv) > 1 else '.formimg'
SEGMENTS = 8          # 切几段
SCALE = 2             # 放大倍数


def read_png(path):
    d = open(path, 'rb').read()
    pos = 8
    idat = b''
    w = h = bd = ct = None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos + 4])[0]
        tag = d[pos + 4:pos + 8]
        data = d[pos + 8:pos + 8 + ln]
        if tag == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', data[:10])
        elif tag == b'IDAT':
            idat += data
        pos += 12 + ln
    raw = zlib.decompress(idat)
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride = w * bpp
    # 反滤波
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _ in range(h):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out += line
        prev = line
    return w, h, bpp, bytes(out)


def write_png(path, w, h, rgb_bytes):
    """rgb_bytes: 每行 w*3 字节"""
    raw = b''.join(b'\x00' + rgb_bytes[y * w * 3:(y + 1) * w * 3] for y in range(h))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def crop_scale(w, h, bpp, buf, y0, y1, scale):
    rows = []
    for y in range(y0, y1):
        base = y * w * bpp
        line = bytearray()
        for x in range(w):
            px = buf[base + x * bpp: base + x * bpp + 3]
            for _ in range(scale):
                line += px
        for _ in range(scale):
            rows.append(bytes(line))
    return b''.join(rows)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    w, h, bpp, buf = read_png(SRC)
    print('源图 %dx%d bpp=%d' % (w, h, bpp))
    step = (h + SEGMENTS - 1) // SEGMENTS
    for i in range(SEGMENTS):
        y0 = i * step
        y1 = min(h, y0 + step)
        if y0 >= y1:
            break
        new_h = (y1 - y0) * SCALE
        new_w = w * SCALE
        data = crop_scale(w, h, bpp, buf, y0, y1, SCALE)
        out = os.path.join(OUT_DIR, 'seg%d.png' % (i + 1))
        write_png(out, new_w, new_h, data)
        print('  %s  (%d,%d)-(%d,%d) -> %dx%d' % (out, 0, y0, w, y1, new_w, new_h))


if __name__ == '__main__':
    main()
