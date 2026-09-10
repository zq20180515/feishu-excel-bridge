import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import {
  attr,
  basename,
  dirname,
  findAll,
  firstOpenTag,
  innerText,
  parseRelationships,
  resolveZipPath,
  escapeRegExp,
} from './xml'
import { inferFieldType, rawToText } from './infer'
import { cellKey, colLetter } from './types'
import type { CellRaw, ParsedFile, SourceColumn, SourceSheet } from './types'
import { canExtractMedia, extOf, lookupFileType, mimeOfName, normalizeImageExt } from './field-meta'

const MAX_ROWS = 20000
const MAX_COLS = 512
const SAMPLE_ROWS = 8

/**
 * 匹配一个 drawing 锚点块（twoCellAnchor / oneCellAnchor）。
 * absoluteAnchor 没有 from 单元格，直接忽略。
 */
const ANCHOR_RE = /<((?:[A-Za-z_][\w.-]*:)?(?:twoCellAnchor|oneCellAnchor))\b[\s\S]*?<\/\1\s*>/gi

type ZipEntry = { path: string; file: JSZip.JSZipObject }

function listEntries(zip: JSZip): ZipEntry[] {
  const out: ZipEntry[] = []
  zip.forEach((path, file) => {
    if (!file.dir) out.push({ path, file })
  })
  return out
}

function pick(entries: ZipEntry[], re: RegExp): ZipEntry | null {
  const found = entries.find((e) => re.test(e.path))
  return found ?? null
}

function exact(entries: ZipEntry[], path: string): ZipEntry | null {
  const lower = path.toLowerCase()
  return entries.find((e) => e.path.toLowerCase() === lower) ?? null
}

/**
 * 从公式里抠出 DISPIMG 的图片 ID。
 * 兼容三种写法：
 *   DISPIMG("ID_8805AC...",1)
 *   _xlfn.DISPIMG("ID_8805AC...",1)     ← 真实 WPS 产出带 _xlfn. 前缀
 *   =DISPIMG("ID_8805AC...",1)          ← 单元格 <v> 里的缓存文本
 */
export function extractDispImgId(formula: string): string | null {
  if (!formula || !/DISPIMG/i.test(formula)) return null
  const quoted = formula.match(/DISPIMG\s*\(\s*"([^"]+)"/i)
  if (quoted) return quoted[1].trim()
  const single = formula.match(/DISPIMG\s*\(\s*'([^']+)'/i)
  if (single) return single[1].trim()
  const bare = formula.match(/DISPIMG\s*\(\s*([A-Za-z0-9_\-]+)/i)
  return bare ? bare[1].trim() : null
}

function cellRaw(cell: XLSX.CellObject | undefined): CellRaw {
  if (!cell) return null
  const t = (cell as XLSX.CellObject).t
  const v = (cell as XLSX.CellObject).v as unknown
  if (v === undefined || v === null || v === '') return null
  if (t === 'd') return v instanceof Date ? v : new Date(String(v))
  if (t === 'b') return Boolean(v)
  if (t === 'n') return typeof v === 'number' ? v : Number(v)
  if (t === 'e') return String(v)
  if (v instanceof Date) return v
  return String(v)
}

/* ------------------------------------------------------------------ */
/* 媒体资源：浮动图片（drawing） + WPS 内嵌图（cellimages）            */
/* ------------------------------------------------------------------ */

type MediaLocator = { path: string; fileName: string }

async function mapSheetPaths(entries: ZipEntry[], warnings: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wbEntry = pick(entries, /^xl\/workbook\.xml$/i)
  if (!wbEntry) return out
  const wbXml = await wbEntry.file.async('string')
  const relEntry = pick(entries, /^xl\/_rels\/workbook\.xml\.rels$/i)
  if (!relEntry) {
    warnings.push('workbook.xml.rels 缺失，无法定位工作表文件，图片可能无法解析。')
    return out
  }
  const rels = parseRelationships(await relEntry.file.async('string'))
  const byId = new Map(rels.map((r) => [r.id, r.target]))
  for (const tag of findAll(wbXml, 'sheet')) {
    const name = attr(tag, 'name')
    const rid = attr(tag, 'r:id')
    if (!name || !rid) continue
    const target = byId.get(rid)
    if (!target) continue
    out.set(name, resolveZipPath('xl', target))
  }
  return out
}

/** 标准 OOXML 浮动图片：worksheet -> drawing -> media */
async function readSheetDrawings(
  entries: ZipEntry[],
  sheetPath: string,
  mediaLoader: (loc: MediaLocator) => Promise<File | null>,
  warnings: string[],
): Promise<Map<string, File[]>> {
  const out = new Map<string, File[]>()
  const relPath = resolveZipPath(dirname(sheetPath), `_rels/${basename(sheetPath)}.rels`)
  const relEntry = exact(entries, relPath)
  if (!relEntry) return out
  const rels = parseRelationships(await relEntry.file.async('string')).filter((r) =>
    /\/drawing$/i.test(r.type),
  )
  if (!rels.length) return out

  for (const rel of rels) {
    const drawPath = resolveZipPath(dirname(sheetPath), rel.target)
    const drawEntry = exact(entries, drawPath)
    if (!drawEntry) continue
    const drawXml = await drawEntry.file.async('string')

    const drawRelPath = resolveZipPath(dirname(drawPath), `_rels/${basename(drawPath)}.rels`)
    const drawRelEntry = exact(entries, drawRelPath)
    const ridToMedia = new Map<string, string>()
    if (drawRelEntry) {
      for (const r of parseRelationships(await drawRelEntry.file.async('string'))) {
        if (/\/image$/i.test(r.type)) ridToMedia.set(r.id, resolveZipPath(dirname(drawPath), r.target))
      }
    }
    if (!ridToMedia.size) continue

    const anchors = drawXml.match(ANCHOR_RE) ?? []
    for (const anchor of anchors) {
      const fromBlock = findAll(anchor, 'from')[0]
      if (!fromBlock) continue
      const rowTxt = innerText(fromBlock, 'row')
      const colTxt = innerText(fromBlock, 'col')
      const row = Number(rowTxt)
      const col = Number(colTxt)
      if (!Number.isFinite(row) || !Number.isFinite(col)) continue

      const pics = findAll(anchor, 'pic')
      for (const pic of pics) {
        const blip = firstOpenTag(pic, 'blip')
        const embed = blip ? attr(blip, 'r:embed') : null
        const mediaPath = embed ? ridToMedia.get(embed) : null
        if (!mediaPath) continue
        const cNvPr = firstOpenTag(pic, 'cNvPr')
        const descr = cNvPr ? attr(cNvPr, 'descr') : null
        const file = await mediaLoader({
          path: mediaPath,
          fileName: descr && /\.[A-Za-z0-9]{2,5}$/.test(descr) ? descr : basename(mediaPath),
        })
        if (!file) continue
        const key = cellKey(row, col)
        const list = out.get(key) ?? []
        list.push(file)
        out.set(key, list)
      }
    }
  }
  return out
}

/**
 * WPS 专有：xl/cellimages.xml 里存放「嵌入单元格」的图片，
 * 单元格公式形如 =DISPIMG("ID_8805AC...",1)，ID 存在 xdr:cNvPr/@name 上。
 */
async function readCellImages(entries: ZipEntry[], warnings: string[]): Promise<{ byId: Map<string, MediaLocator>; ordered: MediaLocator[] }> {
  const byId = new Map<string, MediaLocator>()
  const ordered: MediaLocator[] = []
  const ciEntry = pick(entries, /(^|\/)cellimages\.xml$/i)
  if (!ciEntry) return { byId, ordered }

  const ciXml = await ciEntry.file.async('string')
  const relPath = resolveZipPath(dirname(ciEntry.path), `_rels/${basename(ciEntry.path)}.rels`)
  const relEntry = exact(entries, relPath)
  const ridToMedia = new Map<string, string>()
  if (relEntry) {
    for (const r of parseRelationships(await relEntry.file.async('string'))) {
      if (/\/image$/i.test(r.type)) ridToMedia.set(r.id, resolveZipPath(dirname(ciEntry.path), r.target))
    }
  } else {
    warnings.push('cellimages.xml.rels 缺失，内嵌图片（DISPIMG）无法定位到媒体文件。')
  }

  const pics = findAll(ciXml, 'pic')
  let index = 0
  for (const pic of pics) {
    const blip = firstOpenTag(pic, 'blip')
    const embed = blip ? attr(blip, 'r:embed') : null
    const mediaPath = embed ? ridToMedia.get(embed) : null
    if (!mediaPath) continue
    const cNvPr = firstOpenTag(pic, 'cNvPr')
    const name = cNvPr ? attr(cNvPr, 'name') : null
    const descr = cNvPr ? attr(cNvPr, 'descr') : null
    const ext = normalizeImageExt(extOf(mediaPath) || 'png')
    const fileName =
      descr && /\.[A-Za-z0-9]{2,5}$/.test(descr) ? descr : name && /\.[A-Za-z0-9]{2,5}$/.test(name) ? name : `${name || `image${index + 1}`}.${ext}`
    const loc: MediaLocator = { path: mediaPath, fileName }
    ordered.push(loc)
    if (name) byId.set(name, loc)
    index++
  }
  return { byId, ordered }
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

export type ParseOptions = {
  /** 1-based 表头行号；null/undefined = 自动取第一行非空行 */
  headerRow?: number | null
  /** 是否把「整列为空」的列过滤掉 */
  dropEmptyColumns?: boolean
}

export async function parseWorkbookFile(file: File, opts: ParseOptions = {}): Promise<ParsedFile> {
  const warnings: string[] = []
  const buffer = await file.arrayBuffer()

  const fileType = lookupFileType(file.name)
  if (fileType && !fileType.zip) {
    warnings.push(
      `「${file.name}」是 ${fileType.label}（.${fileType.ext}）：单元格内容可以正常读取，但这类格式不含图片部件，图片列会解析为空。需要带上图片，请先用 WPS / Excel 另存为 .xlsx。`,
    )
  }

  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(new Uint8Array(buffer), {
      type: 'array',
      cellDates: true,
      cellFormula: true,
      cellHTML: false,
      cellNF: false,
      sheetStubs: true,
    })
  } catch (e) {
    throw new Error(
      `无法解析「${file.name}」${fileType ? `（${fileType.label}）` : ''}：${String((e as Error)?.message ?? e)}。请确认文件没有损坏，或另存为 .xlsx 后重试。`,
    )
  }

  if (!wb?.SheetNames?.length) {
    throw new Error(`「${file.name}」里没有找到任何工作表。`)
  }

  let entries: ZipEntry[] = []
  let zipOk = false
  try {
    const zip = await JSZip.loadAsync(buffer)
    entries = listEntries(zip)
    // 有些非 zip 的字节流也能被 JSZip 误判，再确认一次真的有 xl/ 目录
    zipOk = entries.some((e) => e.path.toLowerCase().startsWith('xl/'))
  } catch {
    /* 走下面的分支 */
  }

  if (!zipOk && !fileType) {
    warnings.push(
      '该文件不是标准的 Excel（zip）容器，其中的图片无法被解析。建议先用 WPS / Excel 另存为 .xlsx。',
    )
  }

  const mediaCache = new Map<string, File | null>()
  const mediaLoader = async (loc: MediaLocator): Promise<File | null> => {
    if (mediaCache.has(loc.path)) return mediaCache.get(loc.path) ?? null
    const entry = exact(entries, loc.path)
    if (!entry) {
      mediaCache.set(loc.path, null)
      return null
    }
    try {
      const bytes = await entry.file.async('uint8array')
      const type = mimeOfName(loc.fileName, mimeOfName(loc.path))
      const f = new File([bytes as unknown as BlobPart], loc.fileName || basename(loc.path), { type })
      mediaCache.set(loc.path, f)
      return f
    } catch {
      mediaCache.set(loc.path, null)
      return null
    }
  }

  const sheetPathByName = zipOk ? await mapSheetPaths(entries, warnings) : new Map<string, string>()
  const drawingsBySheet = new Map<string, Map<string, File[]>>()
  if (zipOk) {
    for (const name of wb.SheetNames) {
      const p = sheetPathByName.get(name)
      if (!p) continue
      const m = await readSheetDrawings(entries, p, mediaLoader, warnings)
      if (m.size) drawingsBySheet.set(name, m)
    }
  }

  const cellImages = zipOk
    ? await readCellImages(entries, warnings)
    : { byId: new Map<string, MediaLocator>(), ordered: [] as MediaLocator[] }

  /* ---- 先扫一遍所有 DISPIMG 公式，必要时做位置回退匹配 ---- */
  const dispImgCells: { sheet: string; row: number; col: number; id: string }[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
    // 注意：行列一律用「绝对坐标」（从 0 开始），与 drawing 锚点坐标保持同一坐标系
    for (let r = 0; r <= Math.min(range.e.r, MAX_ROWS - 1); r++) {
      for (let c = 0; c <= Math.min(range.e.c, MAX_COLS - 1); c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
        if (!cell) continue
        const raw = cell as unknown as Record<string, unknown>
        const f = typeof raw.f === 'string' ? (raw.f as string) : ''
        const v = typeof raw.v === 'string' ? (raw.v as string) : ''
        // 优先看公式；真实 WPS 会把公式写成 _xlfn.DISPIMG(...)，
        // 若解析器只留下了缓存值，则从 <v> 的 "=DISPIMG(…)" 文本里再抠一次。
        const id = extractDispImgId(f) ?? extractDispImgId(v)
        if (id) dispImgCells.push({ sheet: name, row: r, col: c, id })
      }
    }
  }

  const matchedByName = dispImgCells.filter((d) => cellImages.byId.has(d.id)).length
  const usePositionalFallback =
    dispImgCells.length > 0 && matchedByName < dispImgCells.length && cellImages.ordered.length >= dispImgCells.length
  if (usePositionalFallback && matchedByName === 0 && cellImages.ordered.length) {
    warnings.push('cellimages.xml 中未找到与 DISPIMG 公式对应的 ID，已按出现顺序做位置匹配。')
  }

  const dispImgMedia = new Map<string, File[]>()
  for (let i = 0; i < dispImgCells.length; i++) {
    const d = dispImgCells[i]
    const loc = cellImages.byId.get(d.id) ?? (usePositionalFallback ? cellImages.ordered[i] : undefined)
    if (!loc) continue
    const f = await mediaLoader(loc)
    if (!f) continue
    const key = `${d.sheet}\u0000${cellKey(d.row, d.col)}`
    const list = dispImgMedia.get(key) ?? []
    list.push(f)
    dispImgMedia.set(key, list)
  }

  /* ---- 逐 sheet 构建矩阵 / 表头 / 列 ---- */
  const sheets: SourceSheet[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
    const rowEnd = Math.min(range.e.r, MAX_ROWS - 1)
    const colEnd = Math.min(range.e.c, MAX_COLS - 1)
    if (range.e.r > MAX_ROWS - 1 || range.e.c > MAX_COLS - 1) {
      warnings.push(`工作表「${name}」超过 ${MAX_ROWS} 行 / ${MAX_COLS} 列，已截断处理。`)
    }

    const matrix: CellRaw[][] = []
    // 从 0 开始而不是 range.s，保证 matrix 下标 == Excel 绝对行列，和图片锚点坐标系一致
    for (let r = 0; r <= rowEnd; r++) {
      const row: CellRaw[] = []
      for (let c = 0; c <= colEnd; c++) {
        row.push(cellRaw(ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined))
      }
      matrix.push(row)
    }

    // 合并两种来源的图片
    const mediaByCell = new Map<string, File[]>(drawingsBySheet.get(name) ?? [])
    for (const [k, list] of dispImgMedia) {
      const [sheetName, key] = k.split('\u0000')
      if (sheetName !== name) continue
      const cur = mediaByCell.get(key) ?? []
      mediaByCell.set(key, cur.concat(list))
    }

    const colCount = matrix.reduce((m, row) => Math.max(m, row.length), 0)
    if (!colCount) {
      sheets.push({
        name,
        matrix: [],
        headerRowIndex: 0,
        columns: [],
        totalDataRows: 0,
        mediaByCell,
        importTableName: name,
        importMode: 'create',
        importTableId: '',
      })
      continue
    }

    // 表头行
    let headerRowIndex = opts.headerRow && opts.headerRow > 0 ? opts.headerRow - 1 : -1
    if (headerRowIndex < 0 || headerRowIndex >= matrix.length) {
      headerRowIndex = matrix.findIndex((row) => row.some((v) => rawToText(v).trim() !== ''))
      if (headerRowIndex < 0) headerRowIndex = 0
    }

    const rawHeaders: string[] = []
    for (let c = 0; c < colCount; c++) {
      const h = rawToText(matrix[headerRowIndex]?.[c] ?? null).trim()
      rawHeaders.push(h || `列${colLetter(c)}`)
    }
    // 同名表头去重
    const seen = new Map<string, number>()
    const headers = rawHeaders.map((h) => {
      const n = seen.get(h) ?? 0
      seen.set(h, n + 1)
      return n === 0 ? h : `${h}_${n + 1}`
    })

    const dataRows = matrix.slice(headerRowIndex + 1)
    const dataRowOffset = headerRowIndex + 1

    const columns: SourceColumn[] = []
    for (let c = 0; c < colCount; c++) {
      const values: CellRaw[] = dataRows.map((row) => row[c] ?? null)
      const nonEmpty = values.filter((v) => v !== null && v !== undefined && rawToText(v).trim() !== '')

      let mediaCount = 0
      for (let r = dataRowOffset; r < matrix.length; r++) {
        const list = mediaByCell.get(cellKey(r, c))
        if (list) mediaCount += list.length
      }
      // 表头行本身也可能挂着图片（浮动图常被锚在表头），一并计入但不算数据
      const headerMedia = mediaByCell.get(cellKey(headerRowIndex, c))
      if (headerMedia) mediaCount += headerMedia.length

      if (opts.dropEmptyColumns !== false && nonEmpty.length === 0 && mediaCount === 0) continue

      const samples = nonEmpty.slice(0, SAMPLE_ROWS).map((v) => rawToText(v))
      const inferred = inferFieldType(samples, nonEmpty, mediaCount)

      columns.push({
        key: `${name}::${c}`,
        sheet: name,
        col: c,
        letter: colLetter(c),
        header: headers[c],
        samples,
        valueCount: nonEmpty.length,
        mediaCount,
        inferredType: inferred,
        enabled: true,
        targetFieldId: '',
        targetFieldName: headers[c],
        targetFieldType: inferred,
        typeTouched: false,
      })
    }

    const dataRowCount = dataRows.filter((row) => row.some((v) => rawToText(v).trim() !== '')).length

    sheets.push({
      name,
      matrix,
      headerRowIndex,
      columns,
      totalDataRows: dataRowCount,
      mediaByCell,
      importTableName: name,
      importMode: 'create',
      importTableId: '',
    })
  }

  const totalMedia = sheets.reduce(
    (n, s) => n + s.columns.reduce((m, c) => m + c.mediaCount, 0),
    0,
  )
  if (totalMedia === 0 && wb.SheetNames.length) {
    warnings.push('未在文件中发现任何图片。若原表图片是「浮动图片」或 WPS 的「嵌入单元格图片」，请确认文件已保存为 .xlsx。')
  }

  return { fileName: file.name, sheets, warnings }
}
