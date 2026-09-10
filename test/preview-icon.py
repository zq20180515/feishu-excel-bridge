# -*- coding: utf-8 -*-
"""把图标分别合成到浅底 / 深底 / 圆角裁切上，检查各场景可读性（纯标准库）

用法：python test/preview-icon.py assets/icon-512.png .iconpreview/checker.png
      python test/preview-icon.py assets/icon-512.png .iconpreview/checker.png --sheet
"""
import os
import struct
import sys
import zlib


def read_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a png')
    pos = 8
    w = h = bd = ct = None
    idat = b''
    while pos < len(data):
        (ln,) = struct.unpack('>I', data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if tag == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', body[:10])
        elif tag == b'IDAT':
            idat += body
        elif tag == b'IEND':
            break
    if bd != 8:
        raise ValueError('only 8-bit supported, got %s' % bd)
    nch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * nch
    out = bytearray(stride * h)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(nch, stride):
                line[i] = (line[i] + line[i - nch]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                b = prev[i]
                c = prev[i - nch] if i >= nch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, nch, bytes(out)


def write_png(path, w, h, nch, px):
    stride = w * nch
    raw = b''.join(b'\x00' + px[y * stride:(y + 1) * stride] for y in range(h))
    ct = {1: 0, 3: 2, 4: 6}[nch]

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ct, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def blend_bg(w, h, nch, px, bg, checker=False):
    """把带 alpha 的图合成到纯色/棋盘底上，返回不透明 RGB 数据"""
    out = bytearray(w * h * 3)
    for y in range(h):
        for x in range(w):
            so = (y * w + x) * nch
            if nch == 4:
                r, g, b, al = px[so], px[so + 1], px[so + 2], px[so + 3]
            elif nch == 3:
                r, g, b, al = px[so], px[so + 1], px[so + 2], 255
            else:
                r = g = b = px[so]; al = 255
            if checker:
                c = 204 if ((x // 16 + y // 16) % 2 == 0) else 255
                base = (c, c, c)
            else:
                base = bg
            af = al / 255.0
            o = (y * w + x) * 3
            out[o] = int(r * af + base[0] * (1 - af))
            out[o + 1] = int(g * af + base[1] * (1 - af))
            out[o + 2] = int(b * af + base[2] * (1 - af))
    return bytes(out)


def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else 'preview.png'
    sheet = '--sheet' in sys.argv
    w, h, nch, px = read_png(src)
    print('source: %dx%d, channels=%d' % (w, h, nch))

    # ---- 包围盒（alpha > 8 视为有内容）----
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        ro = y * w * nch
        for x in range(w):
            if px[ro + x * nch + (nch - 1)] > 8:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    cw, chh = maxx - minx + 1, maxy - miny + 1
    print('content bbox: x[%d..%d] y[%d..%d]  = %dx%d' % (minx, maxx, miny, maxy, cw, chh))
    print('fill ratio : %.1f%% (w) x %.1f%% (h)' % (100.0 * cw / w, 100.0 * chh / h))
    print('margins    : left=%d right=%d top=%d bottom=%d' %
          (minx, w - 1 - maxx, miny, h - 1 - maxy))

    opaque = sum(1 for y in range(h) for x in range(w)
                 if px[(y * w + x) * nch + (nch - 1)] > 200)
    print('opaque px  : %d / %d (%.1f%%)' % (opaque, w * h, 100.0 * opaque / (w * h)))

    if not sheet:
        # 只画棋盘格 + 外框
        B = 24
        ow, oh = w + B * 2, h + B * 2
        out = bytearray(ow * oh * 4)
        comp = blend_bg(w, h, nch, px, None, checker=True)
        for y in range(oh):
            for x in range(ow):
                o = (y * ow + x) * 4
                if B <= x < B + w and B <= y < B + h:
                    so = ((y - B) * w + (x - B)) * 3
                    out[o] = comp[so]; out[o + 1] = comp[so + 1]
                    out[o + 2] = comp[so + 2]; out[o + 3] = 255
                else:
                    out[o] = out[o + 1] = out[o + 2] = 40
                    out[o + 3] = 255
        write_png(dst, ow, oh, 4, bytes(out))
        print('preview written: %s (%dx%d)' % (dst, ow, oh))
        return

    # ---- 三联对比：浅底 / 深底 / 圆形裁切 ----
    variants = [
        ('light', (255, 255, 255), False),
        ('dark', (28, 32, 38), False),
        ('chip', (236, 238, 241), True),
    ]
    PAD = 20
    cell = w
    ow = cell * len(variants) + PAD * (len(variants) + 1)
    oh = h + PAD * 2
    out = bytearray(ow * oh * 4)
    for i in range(ow * oh):
        out[i * 4 + 3] = 255
    for ci, (name, bg, use_checker) in enumerate(variants):
        comp = blend_bg(w, h, nch, px, bg, checker=use_checker)
        ox = PAD + ci * (cell + PAD)
        for y in range(h):
            for x in range(w):
                so = (y * w + x) * 3
                o = ((PAD + y) * ow + (ox + x)) * 4
                out[o] = comp[so]; out[o + 1] = comp[so + 1]
                out[o + 2] = comp[so + 2]; out[o + 3] = 255
    write_png(dst, ow, oh, 4, bytes(out))
    print('sheet written: %s (%dx%d)  [light | dark | chip]' % (dst, ow, oh))


if __name__ == '__main__':
    main()
