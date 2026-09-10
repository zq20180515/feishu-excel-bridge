# -*- coding: utf-8 -*-
"""生成 BTNExcel 桥 插件图标 512x512 PNG（纯 Python 标准库，无第三方依赖）

用法：python test/make-icon.py assets/icon-512.png
"""
import os
import struct
import sys
import zlib

S = 512
ACCENT = (12, 107, 99)      # #0c6b63 主色（深青）
ACCENT_D = (10, 87, 80)     # #0a5750 深一档，用于网格与箭头
WHITE = (255, 255, 255)

# 4x 超采样做抗锯齿
SS = 4


def rrect_in(x, y, x0, y0, x1, y1, r):
    """点 (x,y) 是否落在圆角矩形内"""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    # 只有靠近四角的区域才需要做圆角判定
    near_corner_x = x < x0 + r or x > x1 - r
    near_corner_y = y < y0 + r or y > y1 - r
    if near_corner_x and near_corner_y:
        cx = x0 + r if x < x0 + r else x1 - r
        cy = y0 + r if y < y0 + r else y1 - r
        dx, dy = x - cx, y - cy
        return dx * dx + dy * dy <= r * r
    return True


def arrow_in(x, y, x0, y0, x1, y1, thick, head_w, head_h, to_left):
    """水平箭头：一根箭杆 + 一个三角箭头"""
    cy = (y0 + y1) / 2.0
    if to_left:
        # 箭杆从箭头底延伸到右端
        if abs(y - cy) <= thick / 2.0 and x0 + head_h * 0.5 <= x <= x1:
            return True
        if x0 <= x <= x0 + head_h:
            t = (x - x0) / float(head_h)   # 0 = 尖端
            if abs(y - cy) <= (head_w / 2.0) * t:
                return True
    else:
        if abs(y - cy) <= thick / 2.0 and x0 <= x <= x1 - head_h * 0.5:
            return True
        if x1 - head_h <= x <= x1:
            t = (x1 - x) / float(head_h)
            if abs(y - cy) <= (head_w / 2.0) * t:
                return True
    return False


def build():
    rows = []
    # 表格卡片几何（尽量铺满，四周留 ~7% 边距）
    CX0, CY0, CX1, CY1 = 86.0, 172.0, 426.0, 434.0
    HEADER_BOTTOM = 240.0          # 表头深色区下沿
    GX = (199.0, 313.0)            # 竖网格线
    GY = (297.0, 364.0)            # 横网格线（表头之下）
    LW = 13.0                      # 网格线宽
    CR = 30.0                      # 卡片圆角

    for py in range(S):
        row = bytearray()
        for px in range(S):
            cov_bg = cov_card = cov_dark = cov_arrow = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = px * SS + sx + 0.5
                    y = py * SS + sy + 0.5

                    if rrect_in(x, y, 10, 10, S - 10, S - 10, 118):
                        cov_bg += 1

                    if rrect_in(x, y, CX0, CY0, CX1, CY1, CR):
                        cov_card += 1
                        dark = False
                        # 表头实心深色
                        if y <= HEADER_BOTTOM:
                            dark = True
                        # 网格线
                        for gx in GX:
                            if abs(x - gx) <= LW / 2.0:
                                dark = True
                        for gy in GY:
                            if abs(y - gy) <= LW / 2.0:
                                dark = True
                        if dark:
                            cov_dark += 1

                    # 卡片上方一对相对的箭头（表示双向桥接）
                    if arrow_in(x, y, 52, 62, 226, 138, 34, 80, 66, True):
                        cov_arrow += 1
                    if arrow_in(x, y, S - 226, 62, S - 52, 138, 34, 80, 66, False):
                        cov_arrow += 1

            tot = float(SS * SS)
            a_bg = cov_bg / tot
            a_card = cov_card / tot
            a_dark = cov_dark / tot
            a_arrow = cov_arrow / tot

            r, g, b = ACCENT
            if a_card > 0:
                r = r * (1 - a_card) + WHITE[0] * a_card
                g = g * (1 - a_card) + WHITE[1] * a_card
                b = b * (1 - a_card) + WHITE[2] * a_card
            if a_dark > 0:
                r = r * (1 - a_dark) + ACCENT_D[0] * a_dark
                g = g * (1 - a_dark) + ACCENT_D[1] * a_dark
                b = b * (1 - a_dark) + ACCENT_D[2] * a_dark
            if a_arrow > 0:
                r = r * (1 - a_arrow) + WHITE[0] * a_arrow
                g = g * (1 - a_arrow) + WHITE[1] * a_arrow
                b = b * (1 - a_arrow) + WHITE[2] * a_arrow

            row += bytes((
                int(round(r)), int(round(g)), int(round(b)),
                int(round(a_bg * 255)),
            ))
        rows.append(bytes(row))
    return b''.join(b'\x00' + r for r in rows)


def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data +
            struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join('assets', 'icon-512.png')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    raw = build()
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(out, 'wb') as f:
        f.write(png)
    print('written %s (%d bytes)' % (out, len(png)))


if __name__ == '__main__':
    main()
