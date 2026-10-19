import { useEffect, useMemo, useState } from 'react'
import { Search, User, MapPin, BookMarked, Clock } from 'lucide-react'
import type { Reference } from '../types'
import type { RefElements, SettingCategory } from '../refschema'
import { readReferenceAnalysis } from '../reference'

const CAT_LABEL: Record<SettingCategory, string> = {
  location: '地点', item: '物品', faction: '势力', rule: '规则', power: '功法',
}

type Tab = 'characters' | 'settings' | 'foreshadows'

/**
 * 要素详情：展示阶段二真正抽出来的东西。
 *
 * 数据从 `analysis/elements.json` 读，**不是内存快照** —— 关掉应用再打开
 * 结果仍然在。这里只读、只展示，不提供任何写入。
 */
export default function ElementsModal({ refItem, onClose }: { refItem: Reference; onClose: () => void }) {
  const [data, setData] = useState<RefElements | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('characters')
  const [kw, setKw] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      const e = await readReferenceAnalysis<RefElements>(refItem, 'elements')
      if (!alive) return
      setData(e)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [refItem])

  const q = kw.trim()
  const filtered = useMemo(() => {
    if (!data) return { characters: [], settings: [], foreshadows: [] }
    return {
      characters: data.characters.filter((c) =>
        !q || `${c.name}${(c.aliases ?? []).join('')}${c.role}${c.personality}${c.ability}${c.background}${c.motivation}${c.speech}`.includes(q),
      ),
      settings: data.settings.filter((s) =>
        !q || `${s.name}${s.desc}${s.status ?? ''}${s.subtype ?? ''}`.includes(q),
      ),
      foreshadows: data.foreshadows.filter((f) => !q || `${f.title}${f.detail}`.includes(q)),
    }
  }, [data, q])

  /** 六维里只显示有内容的，空字段是模型判定「本批没交代」，不是遗漏 */
  const CHAR_FIELDS: { key: string; label: string }[] = [
    { key: 'appearance', label: '外貌' },
    { key: 'personality', label: '性格' },
    { key: 'background', label: '背景' },
    { key: 'motivation', label: '动机' },
    { key: 'ability', label: '能力' },
    { key: 'speech', label: '口头禅' },
  ]

  const tabs: { key: Tab; label: string; n: number; icon: typeof User }[] = [
    { key: 'characters', label: '角色', n: data?.characters.length ?? 0, icon: User },
    { key: 'settings', label: '设定', n: data?.settings.length ?? 0, icon: MapPin },
    { key: 'foreshadows', label: '伏笔', n: data?.foreshadows.length ?? 0, icon: BookMarked },
  ]

  return (
    <div className="veil" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal em-modal">
        <div className="modal-head">
          <span className="modal-title">要素详情 · {refItem.title}</span>
          <span className="spacer" />
          <button className="icon-btn square" onClick={onClose}>✕</button>
        </div>

        {loading && <div className="modal-body"><div className="note">正在读取 analysis/elements.json…</div></div>}

        {!loading && !data && (
          <div className="modal-body">
            <div className="note">这本书还没有跑过「要素抽取」，或产物已不在目录里。到参考库点「要素抽取」跑一次。</div>
          </div>
        )}

        {!loading && data && (
          <>
            <div className="em-tabs">
              {tabs.map((t) => {
                const Icon = t.icon
                return (
                  <button key={t.key} className={`em-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                    <Icon size={13} /> {t.label} <span className="em-n">{t.n}</span>
                  </button>
                )
              })}
              <span style={{ flex: 1 }} />
              <div className="em-search">
                <Search size={13} />
                <input
                  value={kw}
                  onChange={(e) => setKw(e.target.value)}
                  placeholder="搜索名称 / 别名 / 描述…"
                />
              </div>
            </div>

            <div className="modal-body em-body">
              {tab === 'characters' && (
                <>
                  {!filtered.characters.length && <div className="note">{q ? '没有匹配的角色' : '未抽到角色'}</div>}
                  {filtered.characters.map((c) => (
                    <div className="em-card" key={c.id}>
                      <div className="em-c-h">
                        <span className="em-name">{c.name}</span>
                        {c.role && <span className="chip">{c.role}</span>}
                        <span style={{ flex: 1 }} />
                        <span className="em-ch">第 {c.firstChapter}–{c.lastChapter} 章</span>
                      </div>
                      {(c.aliases ?? []).length > 0 && (
                        <div className="em-alias">别名：{(c.aliases ?? []).join('、')}</div>
                      )}
                      <div className="em-fields">
                        {CHAR_FIELDS.map((f) => {
                          const v = (c as unknown as Record<string, string>)[f.key]
                          if (!v) return null
                          return <div className="em-f" key={f.key}><span className="em-fl">{f.label}</span><span className="em-fv">{v}</span></div>
                        })}
                        {!CHAR_FIELDS.some((f) => (c as unknown as Record<string, string>)[f.key]) && (
                          <div className="note" style={{ fontSize: 11 }}>正文未交代其外貌/性格等细节，模型未作推断。</div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {tab === 'settings' && (
                <>
                  {!filtered.settings.length && <div className="note">{q ? '没有匹配的设定' : '未抽到设定'}</div>}
                  {filtered.settings.map((s) => (
                    <div className="em-card" key={s.id}>
                      <div className="em-c-h">
                        <span className="chip" style={{ background: 'var(--ref-soft)', color: 'var(--ref)' }}>
                          {CAT_LABEL[s.category] ?? s.category}
                        </span>
                        <span className="em-name">{s.name}</span>
                        {s.subtype && <span className="chip">{s.subtype}</span>}
                        <span style={{ flex: 1 }} />
                        {s.status && <span className="em-st">{s.status}</span>}
                      </div>
                      {s.desc ? <div className="em-desc">{s.desc}</div> : <div className="note" style={{ fontSize: 11 }}>未抽到描述。</div>}
                      {s.chapters.length > 0 && (
                        <div className="em-ch-list">出现：{s.chapters.slice(0, 12).map((n) => n).join('、')} 章{s.chapters.length > 12 ? ` 等 ${s.chapters.length} 处` : ''}</div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {tab === 'foreshadows' && (
                <>
                  {!filtered.foreshadows.length && <div className="note">{q ? '没有匹配的伏笔' : '未抽到伏笔'}</div>}
                  {filtered.foreshadows.map((f) => (
                    <div className="em-card" key={f.id}>
                      <div className="em-c-h">
                        <span className="em-name">{f.title}</span>
                        <span className="spacer" />
                        {f.payoffChapter ? (
                          <span className="chip chip-ok"><Clock size={11} /> 第 {f.plantChapter} 埋 → {f.payoffChapter} 收 · 跨 {f.span} 章</span>
                        ) : (
                          <span className="chip chip-warn">第 {f.plantChapter} 章埋 · 未回收</span>
                        )}
                      </div>
                      {f.detail && <div className="em-desc">{f.detail}</div>}
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="modal-foot">
              <span className="note" style={{ fontSize: 11 }}>只读 · 内容由 AI 依据原文归纳，空字段代表原文未交代而非遗漏</span>
              <span className="spacer" />
              <button className="btn btn-ghost" onClick={onClose}>关闭</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
