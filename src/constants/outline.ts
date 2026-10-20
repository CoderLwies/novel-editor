import type { OutlineStatus } from '../types'

/**
 * 章纲进度元信息。
 *
 * 独立于组件存放：目录树（ChapterTree）、大纲表（OutlineView）、
 * 侧栏大纲（SidePanel）、Markdown 导出（project）都要读它，
 * 不能挂在任何一个组件上，否则各处都要反向依赖那个组件。
 */
export const OS_META: Record<OutlineStatus, { label: string; cls: string }> = {
  plan: { label: '计划中', cls: 'os-plan' },
  written: { label: '已成文', cls: 'os-written' },
  revised: { label: '已修纲', cls: 'os-revised' },
}