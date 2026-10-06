import { useState } from 'react'
import Modal from './Modal'
import { actions } from '../store'

const STEPS = [
  { t: '1 · 建书或导入', d: '书架「新建作品」创建新书；或「导入 TXT/MD」「导入项目目录」把已有文稿搬进来（自动拆卷章）。' },
  { t: '2 · 绑定目录落盘', d: '新建时选文件夹，或工作台文件菜单「绑定目录并自动同步」。之后每次编辑自动写入本地 book.json 与 chapters/*.md，外部编辑器改动也可回读。' },
  { t: '3 · 写作与挂纲', d: '中间栏写正文；侧栏「大纲」给每章填目标/转折/钩子、挂出场角色与伏笔埋收；顶栏「大纲」看全书表并拖拽排序。Ctrl+K 可全局搜索。' },
  { t: '4 · 配置 AI', d: '顶栏 ✦ 填入 DeepSeek API Key 后，即可用拆章纲、走向分支、回写章纲，以及选中正文的续写/润色/审查。' },
  { t: '5 · 导出与更新', d: '文件菜单导出 TXT / Markdown / 大纲 / 设定集 / 伏笔表 / EPUB；「检查更新」获取新版本。顶栏 ? 可随时查看帮助。' },
]

export default function OnboardModal() {
  const [step, setStep] = useState(0)
  const last = step === STEPS.length - 1
  const done = () => actions.setOnboarded(true)

  return (
    <Modal
      title="欢迎使用字舟"
      onClose={done}
      width={520}
      foot={
        <>
          <button className="btn btn-ghost" onClick={done}>跳过</button>
          {step > 0 && (
            <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>上一步</button>
          )}
          <button className="btn btn-primary" onClick={() => (last ? done() : setStep((s) => s + 1))}>
            {last ? '开始使用' : '下一步'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{STEPS[step].t}</div>
      <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--text)' }}>{STEPS[step].d}</div>
      <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--text-faint)' }}>
        {step + 1} / {STEPS.length}
      </div>
    </Modal>
  )
}
