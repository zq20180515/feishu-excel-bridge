import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FT, IMPORTABLE_TYPES, fieldTypeLabel, fieldTypeTone } from '../lib/field-meta'
import type { FieldBrief, SourceColumn, SourceSheet, TableBrief } from '../lib/types'
import { IconImage, IconLink, IconTable } from './icons'
import { Popover, Tip } from './ui'

type Props = {
  sheets: SourceSheet[]
  tables: TableBrief[]
  onChange: (sheets: SourceSheet[]) => void
  onLoadFields: (tableId: string) => Promise<FieldBrief[]>
}

function cloneSheets(sheets: SourceSheet[]): SourceSheet[] {
  return sheets.map((s) => ({ ...s, columns: s.columns.map((c) => ({ ...c })) }))
}

/** 映射到已有字段时，色块跟着目标字段的真实类型走 */
function mappedTypeOf(col: SourceColumn, fields: FieldBrief[]): number {
  const hit = fields.find((f) => f.id === col.targetFieldId)
  return hit ? hit.type : col.targetFieldType
}

/**
 * 字段名：单行显示，超出容器宽度时自动来回滚动。
 *
 * 原表里的列名常常长短悬殊（「工号」和「云南贝泰妮生物科技集团采购部名称全称」），
 * 直接铺开会把每行的类型列挤到不同位置，看着就错位。这里固定成单行 + 溢出滚动：
 * 既保证每列对齐，又不会因为截断而看不到全名。
 * 默认是只读按钮，点一下才切成 input 编辑。
 */
function FieldName({
  text,
  title,
  onClick,
}: {
  text: string
  title: string
  onClick: () => void
}) {
  const boxRef = useRef<HTMLButtonElement | null>(null)
  const innerRef = useRef<HTMLSpanElement | null>(null)
  const [overflow, setOverflow] = useState(false)

  useLayoutEffect(() => {
    const box = boxRef.current
    const inner = innerRef.current
    if (!box || !inner) return
    // clientWidth 为 0 说明还没布局（例如测试环境），此时不做判断
    const over = inner.scrollWidth - box.clientWidth
    if (box.clientWidth > 0 && over > 4) {
      setOverflow(true)
      inner.style.setProperty('--fld-shift', `-${over + 2}px`)
    } else {
      setOverflow(false)
      inner.style.removeProperty('--fld-shift')
    }
  }, [text])

  return (
    <button
      type="button"
      ref={boxRef}
      className={overflow ? 'fld-name overflow' : 'fld-name'}
      title={title}
      onClick={onClick}
    >
      <span className="fld-name-inner" ref={innerRef}>
        {text}
      </span>
    </button>
  )
}

export default function MappingEditor({ sheets, tables, onChange, onLoadFields }: Props) {
  const [fieldCache, setFieldCache] = useState<Record<string, FieldBrief[]>>({})
  const inflight = useRef<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  /** 正在编辑字段名的列 key（null = 全部处于只读展示态） */
  const [editingKey, setEditingKey] = useState<string | null>(null)

  // 追加模式下按需加载目标表的字段清单
  useEffect(() => {
    for (const s of sheets) {
      if (s.importMode !== 'append' || !s.importTableId) continue
      if (fieldCache[s.importTableId] || inflight.current.has(s.importTableId)) continue
      inflight.current.add(s.importTableId)
      onLoadFields(s.importTableId)
        .then((list) => setFieldCache((p) => ({ ...p, [s.importTableId]: list })))
        .catch(() => setFieldCache((p) => ({ ...p, [s.importTableId]: [] })))
        .finally(() => inflight.current.delete(s.importTableId))
    }
  }, [sheets, fieldCache, onLoadFields])

  const mutate = (fn: (draft: SourceSheet[]) => void) => {
    const draft = cloneSheets(sheets)
    fn(draft)
    onChange(draft)
  }

  const updateColumn = (sheetName: string, colKey: string, patch: Partial<SourceColumn>) => {
    mutate((draft) => {
      const sheet = draft.find((s) => s.name === sheetName)
      if (!sheet) return
      const col = sheet.columns.find((c) => c.key === colKey)
      if (!col) return
      Object.assign(col, patch)
    })
  }

  if (!sheets.length) return <div className="empty">没有解析到任何工作表</div>

  return (
    <div className="map-list">
      {sheets.map((sheet, si) => {
        const fields = sheet.importTableId ? fieldCache[sheet.importTableId] ?? [] : []
        const appendMode = sheet.importMode === 'append' && !!sheet.importTableId
        const enabledCount = sheet.columns.filter((c) => c.enabled).length
        const isCollapsed = !!collapsed[si]
        const allOn = sheet.columns.every((c) => c.enabled)

        return (
          <div className="sheet-block" key={`sheet-${si}`}>
            {/* ---------- 工作表头部 ---------- */}
            <div className="sheet-head">
              <button
                type="button"
                className="sheet-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((p) => ({ ...p, [si]: !p[si] }))}
              >
                <span className={isCollapsed ? 'caret' : 'caret open'} />
                <span className="sheet-name">{sheet.name}</span>
              </button>
              <span className="sheet-meta">
                {sheet.totalDataRows} 行 · {enabledCount}/{sheet.columns.length} 列
              </span>
              <button
                type="button"
                className="btn ghost xs"
                style={{ marginLeft: 'auto' }}
                onClick={() =>
                  mutate((draft) => {
                    const s = draft[si]
                    const on = s.columns.every((c) => c.enabled)
                    s.columns.forEach((c) => (c.enabled = !on))
                  })
                }
              >
                {allOn ? '全部取消' : '全部启用'}
              </button>
            </div>

            {/* ---------- 目标表选择 ---------- */}
            <div className="sheet-target">
              <label className="field">
                <span className="field-label">导入到</span>
                <select
                  className="input"
                  value={sheet.importMode === 'append' ? sheet.importTableId : '__new__'}
                  onChange={(e) => {
                    const v = e.target.value
                    mutate((draft) => {
                      const s = draft[si]
                      if (v === '__new__') {
                        s.importMode = 'create'
                        s.importTableId = ''
                      } else {
                        s.importMode = 'append'
                        s.importTableId = v
                        s.columns.forEach((c) => {
                          c.targetFieldId = ''
                        })
                      }
                    })
                  }}
                >
                  <option value="__new__">新建数据表</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      追加到：{t.name}
                    </option>
                  ))}
                </select>
              </label>
              {sheet.importMode === 'create' && (
                <label className="field grow">
                  <span className="field-label">新表名称</span>
                  <input
                    className="input"
                    value={sheet.importTableName}
                    placeholder="新数据表名称"
                    onChange={(e) => {
                      const v = e.target.value
                      mutate((draft) => {
                        draft[si].importTableName = v
                      })
                    }}
                  />
                </label>
              )}
            </div>

            {/* ---------- 字段映射 ---------- */}
            {!isCollapsed && (
              <div className="map-rows">
                {sheet.columns.length === 0 && <div className="empty sm">该工作表没有可导入的列</div>}
                {sheet.columns.map((col) => (
                  <div className={col.enabled ? 'map-row' : 'map-row off'} key={col.key}>
                    <label className="map-check" title={col.enabled ? '取消该列的导入' : '启用该列的导入'}>
                      <input
                        type="checkbox"
                        checked={col.enabled}
                        onChange={(e) => updateColumn(sheet.name, col.key, { enabled: e.target.checked })}
                      />
                    </label>

                    {/* 字段名称：只读展示（超长自动滚动），点击才进入编辑 */}
                    <div className="map-name">
                      {editingKey === col.key ? (
                        <input
                          className="input src-input"
                          autoFocus
                          value={col.header}
                          onChange={(e) => {
                            const v = e.target.value
                            updateColumn(sheet.name, col.key, {
                              header: v,
                              targetFieldName: col.targetFieldId ? col.targetFieldName : v,
                            })
                          }}
                          onBlur={() => setEditingKey(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') setEditingKey(null)
                          }}
                        />
                      ) : (
                        <FieldName
                          text={col.header}
                          title={`来源列 ${col.letter}：${col.header}（点击可改名）`}
                          onClick={() => setEditingKey(col.key)}
                        />
                      )}
                      {col.mediaCount > 0 && (
                        <span className="badge acc" title={`该列有 ${col.mediaCount} 个图片/附件`}>
                          <IconImage size={11} />
                          {col.mediaCount}
                        </span>
                      )}
                      {col.mediaCount === 0 && col.valueCount > 0 && (
                        <span className="badge subtle" title={`该列有 ${col.valueCount} 个非空值`}>
                          {col.valueCount}
                        </span>
                      )}
                    </div>

                    <span className="map-arrow" aria-hidden>
                      →
                    </span>

                    {/* 字段类型：胶囊即按钮，点开弹层换类型 */}
                    <div className="map-type">
                      {col.targetFieldId ? (
                        /* 已映射到已有字段：类型由目标字段决定，不可改 */
                        <Tip text={`已映射到已有字段「${col.targetFieldName}」，类型由目标字段决定（${fieldTypeLabel(mappedTypeOf(col, fields))}）`}>
                          <span className={`tk tk-${fieldTypeTone(mappedTypeOf(col, fields))} tk-static`}>
                            <i className="tk-dot" />
                            <span className="tk-text">{fieldTypeLabel(mappedTypeOf(col, fields))}</span>
                            <IconLink size={11} />
                          </span>
                        </Tip>
                      ) : (
                        <Popover
                          ariaLabel="选择字段类型"
                          trigger={({ open, toggle }) => (
                            <button
                              type="button"
                              className={`tk tk-${fieldTypeTone(col.targetFieldType)} tk-btn${open ? ' open' : ''}`}
                              title={`导入后的字段类型：${fieldTypeLabel(col.targetFieldType)}，点击更换`}
                              aria-haspopup="dialog"
                              aria-expanded={open}
                              onClick={toggle}
                            >
                              <i className="tk-dot" />
                              <span className="tk-text">{fieldTypeLabel(col.targetFieldType)}</span>
                              <span className="tk-caret" aria-hidden />
                            </button>
                          )}
                        >
                          {({ close }) => (
                            <span className="tk-menu" role="listbox">
                              {appendMode && fields.length > 0 && (
                                <>
                                  <span className="tk-sec">
                                    <IconTable size={11} />
                                    映射到已有字段
                                  </span>
                                  <span className="tk-target">
                                    <select
                                      className="input"
                                      value={col.targetFieldId}
                                      onChange={(e) => {
                                        const v = e.target.value
                                        if (!v) {
                                          updateColumn(sheet.name, col.key, {
                                            targetFieldId: '',
                                            targetFieldName: col.header,
                                          })
                                          return
                                        }
                                        const meta = fields.find((f) => f.id === v)
                                        updateColumn(sheet.name, col.key, {
                                          targetFieldId: v,
                                          targetFieldName: meta?.name ?? col.targetFieldName,
                                          targetFieldType: meta ? meta.type : col.targetFieldType,
                                        })
                                      }}
                                    >
                                      <option value="">不映射（新建字段）</option>
                                      {fields.map((f) => (
                                        <option key={f.id} value={f.id}>
                                          {f.name}（{fieldTypeLabel(f.type)}）
                                        </option>
                                      ))}
                                    </select>
                                  </span>
                                  <span className="tk-sec">或新建为</span>
                                </>
                              )}
                              {IMPORTABLE_TYPES.map((t) => (
                                <button
                                  key={t.value}
                                  type="button"
                                  role="option"
                                  aria-selected={t.value === col.targetFieldType}
                                  className={`tk-item${t.value === col.targetFieldType ? ' on' : ''}`}
                                  onClick={() => {
                                    updateColumn(sheet.name, col.key, {
                                      targetFieldType: t.value,
                                      inferredType: t.value,
                                      typeTouched: true,
                                    })
                                    close()
                                  }}
                                >
                                  <span className={`tk tk-${fieldTypeTone(t.value)}`}>
                                    <i className="tk-dot" />
                                    {t.label}
                                  </span>
                                  {t.value === col.targetFieldType && <span className="tk-check">✓</span>}
                                </button>
                              ))}
                            </span>
                          )}
                        </Popover>
                      )}
                      {col.targetFieldType === FT.Attachment && !col.typeTouched && col.mediaCount === 0 && (
                        <Tip text="该列被识别为附件字段，但没有检测到图片，导入后会得到空附件。">
                          <span className="dot warn" />
                        </Tip>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
