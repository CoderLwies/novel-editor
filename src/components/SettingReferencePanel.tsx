import { useEffect, useMemo, useState } from 'react'
import { Check, AlertTriangle } from 'lucide-react'
import { useStore, actions } from '../store'
import type { SettingItem, SettingCategory, ID } from '../types'
import type { RefElements } from '../refschema'
import { readReferenceAnalysis, writeReferenceAnalysis } from '../reference'
import {
  groupBySubtype,
  coverChecklist,
  subtypeLabel,
  SETTING_CATEGORY_LABEL,
  type ChecklistItem,
  type ItemCoverage,
} from '../refderive'
import { sysChecklistPrompt } from '../refprompt'
import PanelShell, { WarnBox, EmptyNote, SourceNote } from './PanelShell'

/** checklists.json 的形态：按 subtype 索引，避免不同子类型互相覆盖 */
type ChecklistStore = Record<string, ChecklistItem[]>

/**
 * 设定面板回答的是「我缺什么」，不是「我从哪来」。
 *
 * 要素清单需要模型归纳（同 subtype 的设定有什么共性），但**缺口判定是本地的** ——
 * 用关键词匹配设定的描述。结果可解释，也能告诉用户「因为你写了『祖制』所以这条算有」。
 * 清单按 subtype 落盘复用，不重复花钱。
 */
export default function SettingReferencePanel({
  setting,
  onClose,
  onAppend,
}: {
  setting: SettingItem
  onClose: () => void
  onAppend: (text: string) => void
}) {
  const state = useStore()
  const refs = state.references
  const [elements, setElements] = useState<{ refId: ID; refTitle: string; elements: RefElements }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const category = setting.category as SettingCategory
  const subtype = setting.subtype?.trim() || ''

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      const out: { refId: ID; refTitle: string; elements: RefElements }[] = []
      for (const r of refs) {
        const e = await readReferenceAnalysis<RefElements>(r, 'elements')
        if (e?.settings?.length) out.push({ refId: r.id, refTitle: r.title, elements: e })
      }
      if (!alive) return
      setElements(out)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [refs])

  const groups = useMemo(() => groupBySubtype(elements, category), [elements, category])

  /** 当前设定归属哪组：优先按 subtype 匹配，否则落在条目最多的一组 */
  const group = useMemo(() => {
    if (!groups.length) return null
    if (subtype) {
      const hit = groups.find((g) => g.subtype === subtype)
      if (hit) return hit
    }
    return [...groups].sort((a, b) => b.items.length - a.items.length)[0]
  }, [groups, subtype])

  const groupKey = group ? `${category}:${group.subtype}` : ''

  // 读缓存：任一已有清单的参考书里命中这个 subtype 就能直接用
  useEffect(() => {
    let alive = true
    setChecklist(null)
    if (!groupKey) return
    ;(async () => {
      for (const e of elements) {
        const ref = refs.find((r) => r.id === e.refId)
        if (!ref) continue
        const store = await readReferenceAnalysis<ChecklistStore>(ref, 'checklists')
        const hit = store?.[groupKey]
        if (hit?.length && alive) {
          setChecklist(hit)
          return
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [groupKey, elements, refs])

  async function generate() {
    if (!group || !groupKey) return
    setBusy(true)
    setErr(null)
    try {
      const prompt = sysChecklistPrompt(
        SETTING_CATEGORY_LABEL[category],
        subtypeLabel(group.subtype),
        group.items,
      )
      const items: ChecklistItem[] = (
        (await actions.checklistOnce(prompt)).items ?? []
      )
        .map((i, k) => ({
          key: (i.key ?? `i${k}`).trim(),
          label: (i.label ?? '').trim(),
          why: (i.why ?? '').trim(),
          keywords: (i.keywords ?? []).map((w) => String(w).trim()).filter(Boolean),
        }))
        .filter((i) => i.label)
      setChecklist(items)
      // 落盘复用：合并进已有清单表，不覆盖其他子类型
      const ref = refs.find((r) => r.id === elements[0]?.refId)
      if (ref && items.length) {
        const store = (await readReferenceAnalysis<ChecklistStore>(ref, 'checklists')) ?? {}
        await writeReferenceAnalysis(ref, 'checklists', { ...store, [groupKey]: items })
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const coverage: ItemCoverage[] = checklist
    ? coverChecklist({ desc: setting.desc, status: setting.status }, checklist)
    : []
  const missing = coverage.filter((c) => !c.hit)

  return (
    <PanelShell
      title="设定参考"
      context={`${SETTING_CATEGORY_LABEL[category]} · ${setting.name}`}
      onClose={onClose}
      footer={
        group
          ? `${group.items.length} 条同类设定 · 来自《${[...new Set(group.items.map((i) => i.refTitle))].join('》《')}》`
          : undefined
      }
    >
      {loading && <EmptyNote>正在读取参考书的设定…</EmptyNote>}

      {!loading && !group && (
        <EmptyNote>
          还没有同类设定可参照。到参考库对参考书跑一次「要素抽取」，
          这里就能对比别人怎么写{SETTING_CATEGORY_LABEL[category]}。
        </EmptyNote>
      )}

      {!loading && group && (
        <>
          <div className="rp-sec">
            <div className="eyebrow" style={{ marginBottom: 7 }}>同类设定 · {subtypeLabel(group.subtype)}</div>
            {!checklist && (
              <>
                <div className="rp-note" style={{ marginBottom: 9 }}>
                  从这 {group.items.length} 条同类设定里归纳出「必须具备哪些要素」，然后对照你当前这张设定
                  指出缺什么。一次轻量调用，结果会缓存复用。
                </div>
                <button className="btn btn-primary btn-sm" style={{ width: '100%', justifyContent: 'center' }}
                  disabled={busy} onClick={generate}>
                  {busy ? '正在归纳…' : '归纳要素清单并检查缺口'}
                </button>
              </>
            )}
            {err && <WarnBox>{err}</WarnBox>}
          </div>

          {checklist && (
            <div className="rp-sec">
              <div className="rp-checklist">
                {coverage.map((c) => (
                  <div className={`sp-row ${c.hit ? 'ok' : 'no'}`} key={c.item.key}>
                    <span className="sp-mark">{c.hit ? <Check size={12} /> : <AlertTriangle size={12} />}</span>
                    <div className="sp-body">
                      <div className="sp-l">{c.item.label}</div>
                      <div className="sp-w">{c.item.why}</div>
                      {c.hit && c.matchedKeyword && <div className="sp-hit">已覆盖 · 命中「{c.matchedKeyword}」</div>}
                    </div>
                  </div>
                ))}
              </div>
              {missing.length > 0 ? (
                <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 11 }}
                  onClick={() =>
                    onAppend(
                      `【参考：${subtypeLabel(group.subtype)} 的要素清单】\n` +
                        missing.map((c) => `- ${c.item.label}：${c.item.why}`).join('\n'),
                    )
                  }>
                  把缺失的 {missing.length} 项追加到设定描述
                </button>
              ) : (
                <div className="rp-note" style={{ marginTop: 11 }}>
                  这一类的要素你都写到了。
                </div>
              )}
              <SourceNote>
                《{[...new Set(group.items.map((i) => i.refTitle))].join('》《')}》 · {group.items.length} 条同类型设定归纳
              </SourceNote>
            </div>
          )}

          <div className="rp-sec">
            <div className="eyebrow" style={{ marginBottom: 7 }}>参考书怎么写的</div>
            <div className="rp-refset">
              {group.items.slice(0, 6).map((s, i) => (
                <div className="rset-card" key={i}>
                  <div className="rs-h">
                    <span className="rs-n">{s.name}</span>
                    <span className="rs-src">{s.refTitle}</span>
                  </div>
                  <div className="rs-d">{s.desc || '（无描述）'}</div>
                  {s.status && <div className="rs-st">状态：{s.status}</div>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </PanelShell>
  )
}
