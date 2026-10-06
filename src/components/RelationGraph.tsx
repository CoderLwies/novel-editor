import Modal from './Modal'
import type { Character } from '../types'

/** 角色关系图：圆环布局 SVG，节点可点击跳角色卡 */
export default function RelationGraph({
  chars,
  onClose,
  onJump,
}: {
  chars: Character[]
  onClose: () => void
  onJump: (id: string) => void
}) {
  const W = 600
  const H = 420
  const cx = W / 2
  const cy = H / 2
  const pos = new Map(
    chars.map((c, i) => {
      const a = (i / Math.max(1, chars.length)) * Math.PI * 2 - Math.PI / 2
      return [c.id, { x: cx + 216 * Math.cos(a), y: cy + 160 * Math.sin(a) }] as [string, { x: number; y: number }]
    }),
  )
  const edges: { from: Character; to: Character; label: string }[] = []
  for (const c of chars) {
    for (const r of c.relations ?? []) {
      const t = chars.find((x) => x.id === r.targetId)
      if (t) edges.push({ from: c, to: t, label: r.relation })
    }
  }
  return (
    <Modal title="角色关系图" onClose={onClose} width={660}>
      {chars.length === 0 && <div className="ai-ok">还没有角色。</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {edges.map((e, i) => {
          const p1 = pos.get(e.from.id)
          const p2 = pos.get(e.to.id)
          if (!p1 || !p2) return null
          const mx = (p1.x + p2.x) / 2
          const my = (p1.y + p2.y) / 2
          return (
            <g key={i}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--border)" strokeWidth={1.2} />
              <text x={mx} y={my - 4} fontSize={10} fill="var(--text-faint)" textAnchor="middle">
                {e.label}
              </text>
            </g>
          )
        })}
        {chars.map((c) => {
          const p = pos.get(c.id)
          if (!p) return null
          return (
            <g
              key={c.id}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                onJump(c.id)
                onClose()
              }}
            >
              <circle cx={p.x} cy={p.y} r={16} fill="var(--accent)" opacity={0.85} />
              <text x={p.x} y={p.y + 30} fontSize={11} fill="var(--text)" textAnchor="middle">
                {c.name}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="hint">点击节点跳转到对应角色卡；连线为关系称谓（单向登记）。</div>
    </Modal>
  )
}
