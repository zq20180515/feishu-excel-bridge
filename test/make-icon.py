# -*- coding: utf-8 -*-
"""生成 BTNExcel 桥 插件图标 PNG（纯 Python 标准库，无第三方依赖）

设计：无底板，透明背景上直接是「双向箭头 + 表格卡片」，
内容铺满画布（四周留 ~6% 安全边距），适合插件市场的圆形/方形裁切。

用法：
    python test/make-icon.py assets/icon-512.png          # 512x512
    python test/make-icon.py assets/icon-512.png 512
"""
import os
import struct
import sys
import zlib

S = 512
ACCENT = (12, 107, 99)      # #0c6b63 主色（深青）
ACCENT_D = (10, 87, 80)     # #0a5750 深一档，用于网格与表头

# 4x 超采样做抗锯齿
SS = 4

# ---------------------------------------------------------------- 几何常量
# 四周安全边距（插件市场会做圆形/圆角裁切，留 ~7%）
PAD = 36.0

# 双向箭头区（画布上部）
ARROW_TOP = 62.0
ARROW_BOTTOM = 152.0
ARROW_SIDE = 52.0           # 箭头两端距画布边缘
ARROW_GAP = 46.0            # 两条箭头之间的缝

# 表格卡片（画布下部）
CARD_X0, CARD_X1 = 70.0, 442.0
CARD_Y0, CARD_Y1 = 186.0, 456.0
CARD_R = 32.0               # 卡片圆角
HEADER_BOTTOM = 250.0       # 表头深色区下沿

# 网格：横 2 条 x 竖 2 条 → 3x3 格
GRID_X = (194.0, 318.0)
GRID_Y = (320.0, 388.0)
LINE_W = 13.0

# 箭头白色实心的外描边宽度（保证白底上也看得见轮廓）
EDGE = 7.0


def rrect_in(x, y, x0, y0, x1, y1, r):
    """点 (x,y) 是否落在圆角矩形内"""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    near_x = x < x0 + r or x > x1 - r
    near_y = y < y0 + r or y > y1 - r
    if near_x and near_y:
        cx = x0 + r if x < x0 + r else x1 - r
        cy = y0 + r if y < y0 + r else y1 - r
        dx, dy = x - cx, y - cy
        return dx * dx + dy * dy <= r * r
    return True


def arrow_in(x, y, x0, y0, x1, y1, thick, head_w, head_h, to_left, grow=0.0):
    """水平箭头：一根箭杆 + 一个三角箭头。grow 用于生成外描边（把图形放大）"""
    cy = (y0 + y1) / 2.0
    thick = thick + 2 * grow
    head_w = head_w + 2 * grow
    head_h = head_h + 2 * grow
    if to_left:
        if abs(y - cy) <= thick / 2.0 and x0 + head_h * 0.5 <= x <= x1:
            return True
        if x0 - grow <= x <= x0 + head_h:
            t = (x - (x0 - grow)) / float(head_h)    # 0 = 尖端
            if t > 1:
                t = 1.0
            if abs(y - cy) <= (head_w / 2.0) * t:
                return True
    else:
        if abs(y - cy) <= thick / 2.0 and x0 <= x <= x1 - head_h * 0.5:
            return True
        if x1 - head_h <= x <= x1 + grow:
            t = ((x1 + grow) - x) / float(head_h)
            if t > 1:
                t = 1.0
            if abs(y - cy) <= (head_w / 2.0) * t:
                return True
    return False


def build():
    # 两条箭头各占半幅，中间留缝，视觉上对称
    gap = ARROW_GAP
    half = (S - 2 * ARROW_SIDE - gap) / 2.0   # 每侧宽度
    ay0, ay1 = ARROW_TOP, ARROW_BOTTOM
    a_thick = 28.0
    a_head_w = 74.0
    a_head_h = 56.0

    # 左箭头（向左）: x ∈ [ARROW_SIDE, ARROW_SIDE+half]
    L_X0, L_X1 = ARROW_SIDE, ARROW_SIDE + half
    # 右箭头（向右）: x ∈ [S-ARROW_SIDE-half, S-ARROW_SIDE]
    R_X0, R_X1 = S - ARROW_SIDE - half, S - ARROW_SIDE

    rows = []
    for py in range(S):
        row = bytearray()
        for px in range(S):
            cov_card = cov_dark = cov_arrow = cov_arrow_edge = 0
            for sy in range(SS):
                for sx in range(SS):
                    # 超采样：把子像素映射回 1x 画布坐标（必须除 SS）
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS

                    # ---- 表格卡片 ----
                    if rrect_in(x, y, CARD_X0, CARD_Y0, CARD_X1, CARD_Y1, CARD_R):
                        cov_card += 1
                        dark = False
                        if y <= HEADER_BOTTOM:          # 表头实心深色
                            dark = True
                        for gx in GRID_X:               # 竖网格线
                            if abs(x - gx) <= LINE_W / 2.0:
                                dark = True
                        for gy in GRID_Y:               # 横网格线
                            if abs(y - gy) <= LINE_W / 2.0:
                                dark = True
                        if dark:
                            cov_dark += 1

                    # ---- 双箭头（先描边层、再实心层，两层都计）----
                    in_edge = False
                    in_fill = False
                    for (ax0, ax1, to_left) in ((L_X0, L_X1, True),
                                                (R_X0, R_X1, False)):
                        if arrow_in(x, y, ax0, ay0, ax1, ay1, a_thick,
                                    a_head_w, a_head_h, to_left, EDGE):
                            in_edge = True
                        if arrow_in(x, y, ax0, ay0, ax1, ay1, a_thick,
                                    a_head_w, a_head_h, to_left, 0.0):
                            in_fill = True
                    if in_edge:
                        cov_arrow_edge += 1
                    if in_fill:
                        cov_arrow += 1

            tot = float(SS * SS)
            a_card = cov_card / tot
            a_dark = cov_dark / tot
            a_arrow = cov_arrow / tot
            a_edge = cov_arrow_edge / tot

            # 起点透明：全透明处 alpha=0，颜色取主色，避免边缘发灰
            r, g, b = ACCENT
            a = 0.0

            # 卡片：主色实底
            if a_card > 0:
                r = r * (1 - a_card) + ACCENT[0] * a_card
                g = g * (1 - a_card) + ACCENT[1] * a_card
                b = b * (1 - a_card) + ACCENT[2] * a_card
                a = a_card
            # 表头/网格：更深
            if a_dark > 0:
                r = r * (1 - a_dark) + ACCENT_D[0] * a_dark
                g = g * (1 - a_dark) + ACCENT_D[1] * a_dark
                b = b * (1 - a_dark) + ACCENT_D[2] * a_dark
                a = max(a, a_dark)
            # 箭头：主色实心（浅底/深底都清晰，与卡片同色系统一）
            if a_edge > 0:
                r = r * (1 - a_edge) + ACCENT_D[0] * a_edge
                g = g * (1 - a_edge) + ACCENT_D[1] * a_edge
                b = b * (1 - a_edge) + ACCENT_D[2] * a_edge
                a = max(a, a_edge)
            if a_arrow > 0:
                r = r * (1 - a_arrow) + ACCENT[0] * a_arrow
                g = g * (1 - a_arrow) + ACCENT[1] * a_arrow
                b = b * (1 - a_arrow) + ACCENT[2] * a_arrow
                a = max(a, a_arrow)

            row += bytes((
                int(round(r)), int(round(g)), int(round(b)),
                int(round(min(a, 1.0) * 255)),
            ))
        rows.append(bytes(row))
    return b''.join(b'\x00' + r for r in rows)


def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data +
            struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))


def main():
    global S
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join('assets', 'icon-512.png')
    if len(sys.argv) > 2:
        S = int(sys.argv[2])
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    raw = build()
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(out, 'wb') as f:
        f.write(png)
    print('written %s (%dx%d, %d bytes)' % (out, S, S, len(png)))


if __name__ == '__main__':
    main()
