import Modal from './Modal'

const SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: '快捷键',
    lines: [
      'Ctrl + K：打开统一搜索（章节/正文/角色/设定/伏笔）',
      'Ctrl + Z / Ctrl + Y：编辑器撤销 / 重做',
      '顶栏专注模式按钮：隐藏目录与侧栏、正文居中、启用打字机滚动',
    ],
  },
  {
    title: '写作与大纲',
    lines: [
      '侧栏「大纲」：卷纲与章纲（目标/冲突/转折/钩子/视角/出场角色/伏笔埋收）',
      '顶栏「大纲」：全书大纲表，拖拽排序、跨卷移动、行内改纲状态',
      '编辑器选中正文：续写 / 润色 / 审查（需先配置 AI）',
      '编辑器「历史」按钮：章节快照与回滚（每章 10 份，绑定目录会落盘 history/）',
    ],
  },
  {
    title: 'AI 功能',
    lines: [
      '顶栏 ✦：配置 Base URL / API Key / 模型（预设 deepseek 系列或自填）',
      '大纲 tab 卷头魔棒：AI 拆章纲；章纲内「AI 分支」「回写章纲」',
      '大纲 tab 盾牌：一致性巡检（忘收伏笔、混用称呼、死亡角色仍出场等）',
    ],
  },
  {
    title: '数据与导出',
    lines: [
      '绑定目录后自动落盘 book.json + chapters/*.md，外部改 md 可回读',
      '文件菜单：导出项目包 / TXT / Markdown / 大纲 / 设定集 / 伏笔表 / EPUB',
      '文件菜单「检查更新」：有新版本会下载并提示重启安装',
    ],
  },
  {
    title: '常见问题',
    lines: [
      '安装包打开提示未知发布者：未代码签名所致，点「更多信息 → 仍要运行」',
      '数据在哪：应用内 localStorage；绑定目录的书同时落在所选文件夹',
      '误删章节：编辑器「历史」回滚；未存快照则无法恢复，请勤存快照',
    ],
  },
]

export default function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="帮助与快捷键" onClose={onClose} width={620}>
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <div className="side-section-label">{s.title}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9, color: 'var(--text)' }}>
            {s.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ))}
    </Modal>
  )
}
