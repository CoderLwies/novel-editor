import { useEffect, useState } from 'react'
import { AlertTriangle, Info, Loader2, PlugZap } from 'lucide-react'
import Modal from './Modal'
import { useStore, actions, chaptersOf } from '../store'
import type { Book, Volume, Chapter } from '../types'
import {
  aiReady,
  chatJSON,
  splitOutlinePrompt,
  branchPrompt,
  consistencyCheck,
  SYS_PLANNER,
  type GenChapterOutline,
  type GenBranch,
  type CheckIssue,
} from '../ai'

function AiGuard({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="ai-err">
      尚未配置 AI 接口。墨章对接 OpenAI 兼容协议（baseUrl + model，可选 apiKey）。
      <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onOpenSettings}>
        <PlugZap size={14} /> 去配置
      </button>
    </div>
  )
}

function Err({ text }: { text: string }) {
  return <div className="ai-err">{text}</div>
}

export function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const ai = useStore().ai
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function test() {
    setTesting(true)
    setResult(null)
    try {
      await chatJSON<{ ok?: boolean }>(ai, '只输出 {"ok":true}', 'ping')
      setResult('连接成功，模型响应正常')
    } catch (e) {
      setResult(`连接失败：${(e as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      title="AI 接口设置"
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={test} disabled={testing || !aiReady(ai)}>
            {testing ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />} 测试连接
          </button>
          <button className="btn btn-primary" onClick={onClose}>完成</button>
        </>
      }
    >
      <label className="lbl">Base URL（OpenAI 兼容，如 https://api.xxx.com/v1）</label>
      <input
        className="field"
        value={ai.baseUrl}
        placeholder="https://api.openai.com/v1"
        onChange={(e) => actions.setAiConfig({ baseUrl: e.target.value })}
      />
      <label className="lbl">API Key（可留空，用于本地免鉴权服务）</label>
      <input
        className="field"
        type="password"
        value={ai.apiKey}
        placeholder="sk-…"
        onChange={(e) => actions.setAiConfig({ apiKey: e.target.value })}
      />
      <label className="lbl">模型名</label>
      <input
        className="field"
        value={ai.model}
        placeholder="gpt-4o-mini / deepseek-chat …"
        onChange={(e) => actions.setAiConfig({ model: e.target.value })}
      />
      <div className="hint">
        配置仅保存在本机 localStorage；请求由桌面端直连你所填的地址。
        {result && <div className={result.startsWith('连接成功') ? 'ai-ok' : 'ai-err'} style={{ marginTop: 8 }}>{result}</div>}
      </div>
    </Modal>
  )
}

export function AiSplitModal({
  book,
  vol,
  onClose,
  onOpenSettings,
}: {
  book: Book
  vol: Volume
  onClose: () => void
  onOpenSettings: () => void
}) {
  const state = useStore()
  const [items, setItems] = useState<GenChapterOutline[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    chatJSON<{ chapters?: GenChapterOutline[] }>(
      state.ai,
      SYS_PLANNER,
      splitOutlinePrompt(book, vol, chaptersOf(state, vol.id)),
    )
      .then((r) => {
        if (!alive) return
        const list = (r.chapters ?? []).filter((c) => c && c.title)
        setItems(list)
        setPicked(new Set(list.map((_, i) => i)))
      })
      .catch((e) => alive && setErr((e as Error).message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function apply() {
    for (const i of picked) {
      const g = items![i]
      const ch = actions.createChapter(book.id, vol.id, g.title)
      actions.updateChapter(ch.id, {
        synopsis: g.synopsis ?? '',
        goal: g.goal ?? '',
        conflict: g.conflict ?? '',
        turning: g.turning ?? '',
        hook: g.hook ?? '',
        pov: g.pov ?? '',
        outlineStatus: 'plan',
      })
    }
    onClose()
  }

  return (
    <Modal
      title={`AI 拆章纲 · ${vol.title}`}
      onClose={onClose}
      width={620}
      foot={
        items ? (
          <>
            <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--text-faint)' }}>
              已选 {picked.size} / {items.length} 章，将以"计划中"状态建章
            </span>
            <button className="btn btn-ghost" onClick={onClose}>取消</button>
            <button className="btn btn-primary" disabled={picked.size === 0} onClick={apply}>
              创建所选章节
            </button>
          </>
        ) : undefined
      }
    >
      {!aiReady(state.ai) && <AiGuard onOpenSettings={onOpenSettings} />}
      {aiReady(state.ai) && !items && !err && (
        <div className="ai-loading"><Loader2 size={16} className="spin" /> 正在依据总纲与卷纲规划章节…</div>
      )}
      {err && <Err text={`生成失败：${err}`} />}
      {items?.map((g, i) => (
        <label className={`ai-item ${picked.has(i) ? 'sel' : ''}`} key={i}>
          <input
            type="checkbox"
            checked={picked.has(i)}
            onChange={() =>
              setPicked((prev) => {
                const next = new Set(prev)
                next.has(i) ? next.delete(i) : next.add(i)
                return next
              })
            }
          />
          <span className="ai-item-body">
            <span className="ai-item-title">{g.title}</span>
            <span className="ai-item-desc">{g.synopsis}</span>
            <span className="ai-item-meta">
              冲突：{g.conflict || '—'} · 钩子：{g.hook || '—'} · 视角：{g.pov || '—'}
            </span>
          </span>
        </label>
      ))}
    </Modal>
  )
}

export function AiBranchModal({
  book,
  chapter,
  onClose,
  onOpenSettings,
}: {
  book: Book
  chapter: Chapter
  onClose: () => void
  onOpenSettings: () => void
}) {
  const state = useStore()
  const [branches, setBranches] = useState<GenBranch[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    chatJSON<{ branches?: GenBranch[] }>(state.ai, SYS_PLANNER, branchPrompt(book, chapter))
      .then((r) => alive && setBranches((r.branches ?? []).filter((b) => b && b.label)))
      .catch((e) => alive && setErr((e as Error).message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function adopt(b: GenBranch) {
    actions.updateChapter(chapter.id, {
      synopsis: b.synopsis ?? chapter.synopsis,
      turning: b.turning ?? chapter.turning,
      hook: b.hook ?? chapter.hook,
    })
    onClose()
  }

  return (
    <Modal title={`AI 分支 · ${chapter.title}`} onClose={onClose} width={620}>
      {!aiReady(state.ai) && <AiGuard onOpenSettings={onOpenSettings} />}
      {aiReady(state.ai) && !branches && !err && (
        <div className="ai-loading"><Loader2 size={16} className="spin" /> 正在推演剧情分支…</div>
      )}
      {err && <Err text={`生成失败：${err}`} />}
      {branches?.map((b, i) => (
        <div className="ai-item" key={i}>
          <span className="ai-item-body">
            <span className="ai-item-title">{b.label}</span>
            <span className="ai-item-desc">{b.synopsis}</span>
            <span className="ai-item-meta">转折：{b.turning || '—'} · 钩子：{b.hook || '—'}</span>
          </span>
          <button className="btn btn-ghost" style={{ flex: '0 0 auto' }} onClick={() => adopt(b)}>
            采用
          </button>
        </div>
      ))}
    </Modal>
  )
}

export function AiCheckModal({ book, onClose }: { book: Book; onClose: () => void }) {
  const state = useStore()
  const issues: CheckIssue[] = consistencyCheck(state, book.id)
  return (
    <Modal title="一致性巡检" onClose={onClose} width={560}>
      {issues.length === 0 && <div className="ai-ok">未发现结构与伏笔一致性问题。</div>}
      {issues.map((it, i) => (
        <button
          key={i}
          className="ai-issue"
          onClick={() => {
            if (it.chapterId) actions.selectChapter(it.chapterId)
            onClose()
          }}
          title={it.chapterId ? '点击跳到该章' : ''}
        >
          {it.level === 'warn' ? (
            <AlertTriangle size={14} style={{ color: 'var(--warning)', flex: '0 0 auto' }} />
          ) : (
            <Info size={14} style={{ color: 'var(--text-faint)', flex: '0 0 auto' }} />
          )}
          <span>{it.text}</span>
        </button>
      ))}
    </Modal>
  )
}
