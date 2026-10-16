import type { ReactNode } from 'react'
import { BookMarked } from 'lucide-react'

/**
 * 三个参考面板的共享外壳。
 *
 * 共性：同样的头部、同样的只读语义、同样常驻溯源。
 * 差异全在 body：章纲是「定位我在第几拍」，卷纲是「有哪些走法可选」，
 * 设定是「我缺什么」—— 这三件事不该被硬塞进同一个组件。
 */
export default function PanelShell({
  title,
  context,
  onClose,
  footer,
  children,
}: {
  title: string
  /** 当前作用的上下文，如卷名 / 设定名 */
  context: string
  onClose: () => void
  /** 常驻底部的溯源信息 */
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="refpanel">
      <div className="refpanel-head">
        <BookMarked size={15} />
        <span className="rp-title">{title}</span>
        <span className="rp-ctx">{context}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn square" onClick={onClose} title="收起面板">✕</button>
      </div>
      <div className="refpanel-body">
        {children}
        {footer && <div className="rp-panel-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function WarnBox({ children }: { children: ReactNode }) {
  return <div className="rp-warn">{children}</div>
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="rp-note">{children}</div>
}

/** 溯源脚注：每条结论都要指回出处，这是「借鉴」不变成「抄袭」的前提 */
export function SourceNote({ children }: { children: ReactNode }) {
  return <div className="rp-src-note">溯源：{children}</div>
}
