/**
 * 生成可视化样例文件到 samples/：
 *  1) 示例源表_浮动图.xlsx      —— Excel/WPS「插入图片」的常规形式（浮动锚定）
 *  2) 示例源表_内嵌图.xlsx      —— WPS「嵌入单元格图片」=DISPIMG() 形式
 *  3) 导出效果_WPS内嵌图.xlsx   —— 导出侧产物（图片进单元格）
 *  4) 导出效果_浮动图片.xlsx    —— 导出侧产物（图片锚定单元格）
 * 直接用 WPS / Excel 打开这 4 个文件即可肉眼验证。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { buildXlsxBytes } from '../src/lib/excel-write'
import type { OutSheet } from '../src/lib/excel-write'

/* ---------------- 极简 PNG 编码器（纯色图，用于生成可见样例） ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3)
    raw[off] = 0
    for (let x = 0; x < w; x++) {
      // 做个简单的斜纹，方便肉眼确认图片真的被渲染了
      const dark = ((x + y) >> 4) % 2 === 0 ? 0 : -22
      const p = off + 1 + x * 3
      raw[p] = Math.max(0, Math.min(255, rgb[0] + dark))
      raw[p + 1] = Math.max(0, Math.min(255, rgb[1] + dark))
      raw[p + 2] = Math.max(0, Math.min(255, rgb[2] + dark))
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const OUT_DIR = join(process.cwd(), 'samples')

function img(name: string, rgb: [number, number, number], w = 140, h = 100) {
  return { name, ext: 'png', bytes: new Uint8Array(solidPng(w, h, rgb)) }
}

/* --------------------- 模拟「从 Excel 导入」的源表 --------------------- */

const sourceSheets: OutSheet[] = [
  {
    name: '员工档案',
    headers: ['工号', '姓名', '部门', '照片', '入职日期', '在职'],
    rows: [
      ['BTN001', '张三', '生产部', null, '2023-03-01', '是'],
      ['BTN002', '李四', '质量部', null, '2022-11-15', '是'],
      ['BTN003', '王五', '仓储物流部', null, '2024-06-20', '否'],
    ],
    images: [
      { row: 1, col: 3, img: img('zhangsan.png', [64, 116, 199]) },
      { row: 2, col: 3, img: img('lisi.png', [86, 168, 116]) },
      { row: 3, col: 3, img: img('wangwu.png', [201, 132, 82]) },
    ],
  },
  {
    name: '设备台账',
    headers: ['设备编号', '设备名称', '现场照片', '状态'],
    rows: [
      ['EQ-001', '灌装机 A', null, '正常'],
      ['EQ-002', '封口机 B', null, '维修中'],
    ],
    images: [{ row: 2, col: 2, img: img('eq002.png', [186, 92, 92]) }],
  },
]

/* --------------------- 模拟「从多维表格导出」的结果 --------------------- */

const exportSheets: OutSheet[] = [
  {
    name: '员工档案',
    headers: ['工号', '姓名', '部门', '照片', '照片(附件名)', '入职日期', '在职'],
    rows: [
      ['BTN001', '张三', '生产部', null, 'zhangsan.png', '2023-03-01 00:00:00', true],
      ['BTN002', '李四', '质量部', null, 'lisi.png', '2022-11-15 00:00:00', true],
      ['BTN003', '王五', '仓储物流部', null, 'wangwu.png', '2024-06-20 00:00:00', false],
    ],
    images: [
      { row: 1, col: 3, img: img('zhangsan.png', [64, 116, 199]) },
      { row: 2, col: 3, img: img('lisi.png', [86, 168, 116]) },
      { row: 3, col: 3, img: img('wangwu.png', [201, 132, 82]) },
    ],
  },
  {
    name: '设备台账',
    headers: ['设备编号', '设备名称', '现场照片', '现场照片(附件名)', '状态'],
    rows: [
      ['EQ-001', '灌装机 A', null, '（无附件）', '正常'],
      ['EQ-002', '封口机 B', null, 'eq002.png', '维修中'],
    ],
    images: [{ row: 2, col: 2, img: img('eq002.png', [186, 92, 92]) }],
  },
]

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  // 不传 imageSizePx = 原图原尺寸导出
  const floatBytes = await buildXlsxBytes(sourceSheets, { imageMode: 'float' })
  writeFileSync(join(OUT_DIR, '示例源表_浮动图.xlsx'), floatBytes)

  const dispBytes = await buildXlsxBytes(sourceSheets, { imageMode: 'dispimg' })
  writeFileSync(join(OUT_DIR, '示例源表_内嵌图.xlsx'), dispBytes)

  const expDisp = await buildXlsxBytes(exportSheets, { imageMode: 'dispimg' })
  writeFileSync(join(OUT_DIR, '导出效果_WPS内嵌图.xlsx'), expDisp)

  const expFloat = await buildXlsxBytes(exportSheets, { imageMode: 'float' })
  writeFileSync(join(OUT_DIR, '导出效果_浮动图片.xlsx'), expFloat)

  console.log('已生成：')
  for (const n of ['示例源表_浮动图.xlsx', '示例源表_内嵌图.xlsx', '导出效果_WPS内嵌图.xlsx', '导出效果_浮动图片.xlsx']) {
    console.log('  samples/' + n)
  }
}

void main()
