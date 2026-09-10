/**
 * 极简 XML 工具。
 * 刻意不用 DOMParser / 第三方 XML 库：
 *  - 我们只需要读写 xlsx 内部结构固定、层级很浅的几个部件（drawing / cellimages / rels）
 *  - 正则实现可以在浏览器与 Node 里跑出完全一致的行为，方便写 round-trip 测试
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

export function unescapeXml(s: string): string {
  if (!s || s.indexOf('&') < 0) return s
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    const v = ENTITIES[body.toLowerCase()]
    return v === undefined ? m : v
  })
}

export function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 读一个标签上的属性值，name 可以带前缀（如 r:embed） */
export function attr(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  const m = tag.match(re)
  if (!m) return null
  return unescapeXml(m[1] !== undefined ? m[1] : m[2])
}

/**
 * 取某个局部名的所有完整标签（含内容）。
 * 支持任意命名空间前缀：col / xdr:col / etc:col 都能命中。
 * 限制：不处理嵌套同名标签（xlsx 的这几个部件里不存在这种情况）
 */
export function findAll(xml: string, local: string): string[] {
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${local}\\b[^>]*?(?:/>|>[\\s\\S]*?</(?:[A-Za-z_][\\w.-]*:)?${local}\\s*>)`,
    'gi',
  )
  return xml.match(re) ?? []
}

/** 取某个局部名第一个标签的内部文本，顺带把内层标签剥掉 */
export function innerText(scope: string, local: string): string | null {
  const tag = findAll(scope, local)[0]
  if (!tag) return null
  const open = tag.indexOf('>')
  if (open < 0) return null
  const body = tag.slice(open + 1).replace(/<\/[^>]*>\s*$/, '')
  return unescapeXml(body.replace(/<[^>]*>/g, ''))
}

/** 在 scope 里找第一个含 local 的「起始标签」本身，用于取属性 */
export function firstOpenTag(scope: string, local: string): string | null {
  const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${local}\\b[^>]*?/?>`, 'i')
  const m = scope.match(re)
  return m ? m[0] : null
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** rels 文件里的 Relationship 列表 */
export function parseRelationships(xml: string): { id: string; type: string; target: string }[] {
  return findAll(xml, 'Relationship').map((tag) => ({
    id: attr(tag, 'Id') ?? '',
    type: attr(tag, 'Type') ?? '',
    target: attr(tag, 'Target') ?? '',
  }))
}

/** 把 zip 内的相对路径解析成绝对路径（不加前导斜杠） */
export function resolveZipPath(baseDir: string, target: string): string {
  if (!target) return ''
  if (target.startsWith('/')) return target.replace(/^\/+/, '')
  const stack = baseDir ? baseDir.split('/') : []
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}
