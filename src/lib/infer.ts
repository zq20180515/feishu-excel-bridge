import { FT } from './field-meta'
import type { CellRaw } from './types'

const NUM_RE = /^-?(\d{1,3}(,\d{3})*|\d+)(\.\d+)?$/
const PCT_RE = /^-?(\d+(\.\d+)?)%$/
const CURRENCY_RE = /^[-¥$€£]?\s*\d[\d,]*(\.\d+)?\s*(元|万|亿)?$/
const URL_RE = /^(https?|ftp):\/\/[^\s]+$/i
const EMAIL_RE = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/
const PHONE_CN_RE = /^(\+?86)?1[3-9]\d{9}$/
const DATE_TEXT_RE = /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}(日)?([ T]\d{1,2}:\d{2}(:\d{2})?)?$/
const DATETIME_TEXT_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?$/
const TIME_ONLY_RE = /^\d{1,2}:\d{2}(:\d{2})?$/

export function rawToText(v: CellRaw): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return formatDate(v)
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v)
}

export function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  if (d.getHours() || d.getMinutes() || d.getSeconds()) {
    return `${date} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  return date
}

export function isNumericText(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  return NUM_RE.test(t) || PCT_RE.test(t) || (CURRENCY_RE.test(t) && /\d/.test(t))
}

export function parseNumber(v: CellRaw): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  const t = rawToText(v).trim()
  if (!t) return null
  const pct = PCT_RE.test(t)
  const cleaned = t.replace(/[,\s¥$€£元万亿]/g, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return pct ? n / 100 : n
}

/** Excel 序列号（1900 日期系统）转毫秒时间戳 */
export function excelSerialToMs(serial: number): number {
  return Math.round((serial - 25569) * 86400 * 1000)
}

export function parseDateMs(v: CellRaw): number | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    // 1990~2100 之间的裸数字更可能是 Excel 序列号，而不是毫秒时间戳
    if (v > 0 && v < 100000) return excelSerialToMs(v)
    if (v > 100000000000) return v
    if (v > 1000000000 && v < 4000000000) return v * 1000
    return null
  }
  const t = rawToText(v).trim()
  if (!t) return null
  if (TIME_ONLY_RE.test(t)) {
    const [h, m, s] = t.split(':').map(Number)
    const d = new Date(1970, 0, 1, h, m || 0, s || 0)
    return d.getTime()
  }
  const normalized = t.replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-').replace(/\s+/g, ' ')
  const ms = Date.parse(normalized.replace(/-(\d)(?=[-\s])/g, '-0$1'))
  if (Number.isFinite(ms)) return ms
  const ms2 = Date.parse(normalized)
  return Number.isFinite(ms2) ? ms2 : null
}

export function parseBool(v: CellRaw): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const t = rawToText(v).trim().toLowerCase()
  return t === 'true' || t === 'yes' || t === 'y' || t === '是' || t === '1' || t === '√' || t === '✓'
}

const MULTI_SPLIT_RE = /\s*[,，;；|、\/]\s*/

export function splitMulti(v: CellRaw): string[] {
  return rawToText(v)
    .split(MULTI_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 基于样例值推断字段类型。
 * 有内嵌图片的列一律推断为「附件」——这是本插件存在的意义。
 */
export function inferFieldType(samples: string[], values: CellRaw[], mediaCount: number): number {
  if (mediaCount > 0) return FT.Attachment

  const nonEmpty = values.filter((v) => v !== null && v !== undefined && rawToText(v).trim() !== '')
  if (nonEmpty.length === 0) return FT.Text

  if (nonEmpty.every((v) => typeof v === 'boolean')) return FT.Checkbox
  if (nonEmpty.every((v) => v instanceof Date)) return FT.DateTime

  const texts = nonEmpty.map((v) => rawToText(v).trim())

  if (texts.every((t) => DATE_TEXT_RE.test(t))) {
    return texts.some((t) => DATETIME_TEXT_RE.test(t) || t.includes(':')) ? FT.DateTime : FT.DateTime
  }
  if (texts.every((t) => isNumericText(t))) return FT.Number
  if (texts.every((t) => URL_RE.test(t))) return FT.Url
  if (texts.every((t) => EMAIL_RE.test(t))) return FT.Email
  if (texts.every((t) => PHONE_CN_RE.test(t))) return FT.Phone

  // 低基数且长度可控 -> 单选
  const distinct = new Set(texts)
  const tooLong = texts.some((t) => t.length > 60)
  if (nonEmpty.length >= 3 && distinct.size <= 30 && distinct.size <= Math.max(2, Math.ceil(nonEmpty.length * 0.6)) && !tooLong) {
    return FT.SingleSelect
  }
  if (distinct.size === 1 && texts[0].length <= 60) return FT.SingleSelect

  return FT.Text
}
