import type { AppState } from './types'

/**
 * 工作台视图路由：写作台 / 大纲页。
 *
 * 抽成纯函数是为了让「大纲页是独立视图」这条契约能被单测直接覆盖，
 * 而不是只能靠 E2E 间接验证。
 */
export function resolveWorkspaceView(state: AppState): 'write' | 'outline' {
  return state.ui.view === 'outline' ? 'outline' : 'write'
}
