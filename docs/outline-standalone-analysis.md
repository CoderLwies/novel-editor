# 大纲功能能否单独抽成独立界面 —— 分析

> 分支：`analysis/outline-standalone-ui`
> 结论：**可以抽，成本很低。但"抽哪个大纲"才是真问题。**
>
> **状态（第一步、第二步已落地）**：常量抽取、路由三态化、大纲页独立化、规划台（宽版
> 总纲/卷纲/章纲 + 角色/设定/伏笔）均已实现并通过 typecheck / 28 项单测 /
> production build；Electron E2E 已实跑全绿（退出码 0，`CONSOLE ERRORS: none`）。
> 规划台实测形态：`.tree` + `.plan-main`（5 个 `.plan-tab`）在，无 `.editor-pane`、无 `.side`。
> 第三步（独立窗口）不做。
>
> **复查后修正**：初版曾把大纲页做成"独占全宽"（砍掉目录树与侧栏），实测发现那是
> 功能回退——建卷/删章/改名只在目录树里，章纲字段编辑只在侧栏里。已改回保留两侧。

---

## 一、结论先行

1. **技术上几乎没有阻碍。** `OutlineView` 已经是自包含组件：只依赖 store、utils、一个常量表和一段 CSS，没有引用 Editor / ChapterTree / FileMenu 的任何内部实现。全局 store 是模块级单例 + `useSyncExternalStore`，任何新入口 import 同一个 store 就能拿到全部数据并自动落盘，**不需要 Provider 包裹**。
2. **真正的工作量不在"搬文件"，而在三件事**：确定边界（哪个大纲）、拆掉 `OS_META` 对 `SidePanel` 的反向依赖、定义跨界面导航语义。
3. **建议分两步走**，第一步低风险、几乎不破坏现有交互；第二步才是真正的产品决策。

---

## 二、现状：大纲不是一个功能，是三块

| # | 位置 | 内容 | 规模 |
|---|---|---|---|
| A | `src/components/OutlineView.tsx` | **全书大纲表**：按卷分组的 7 列表格（章节/视角/冲突/钩子/纲状态/字数），拖拽排序、跨卷移动、纲状态下拉、点击回到正文 | 86 行 |
| B | `src/components/SidePanel.tsx` 内的 `OutlineTab` | **三级大纲编辑面板**：总纲 textarea → 卷纲（概括/目标/冲突）→ 章纲（概括/目标/冲突/转折/钩子/视角/故事时间 + 出场角色/伏笔/设定 chips），外加 AI 拆章纲、分支、回写章纲、一致性巡检 | ~270 行 |
| C | `src/components/ChapterTree.tsx` | 目录树，**只借用大纲的状态色点**，无任何大纲字段编辑 | — |

挂载方式：`Workspace.tsx:29` 用一个 `mode: 'write' | 'outline'` 二态开关在 A 和 `Editor` 之间二选一；B 是侧栏 4 个 tab 之一（大纲/角色/设定/伏笔），与 A **并存**、互不同步。

> ⚠️ 也就是说：**A 和 B 是同一份数据的两套 UI，都在编辑章纲，但只有 A 支持排序、只有 B 支持全部字段。** 这是当前架构里最实际的痛点，也是抽独立界面的主要收益点。

---

## 三、耦合清单（决定抽取成本）

### 3.1 `OutlineView` 的完整外部依赖

| 依赖 | 位置 | 抽取后是否成立 |
|---|---|---|
| `useStore()` / `actions` | `../store` | ✅ 全局单例，天然成立 |
| `volumesOf` / `chaptersOf` | `../store` | ✅ 纯选择器 |
| `countWords` / `formatNumber` | `../utils` | ✅ 无副作用 |
| **`OS_META`** | **`./SidePanel`** | ❌ **反向依赖，必须先拆** |
| CSS `.outline-view` / `.ov-*` | `styles/global.css:1253-1355` | ✅ 已是独立一段，只借了 `--editor-bg` |
| `onOpenChapter(id)` | `Workspace.tsx:231` | ❌ 硬编码回写 `setMode('write')` |
| 布局 `.outline-view { flex:1; overflow-y:auto }` | — | ⚠️ 依赖父级 `.ws-body` 是 flex 容器 |

### 3.2 必须先解决的三个问题

**① `OS_META` 的反向依赖（唯一的结构性障碍）**

`OutlineView.tsx:6` 和 `ChapterTree.tsx:6` 都从 `./SidePanel` import `OS_META`（定义在 `SidePanel.tsx:397`）。`SidePanel` 是一个 60KB / 1000+ 行的大组件，为抽一个 5 行常量把整个侧栏模块图拖进依赖里。

> 只要大纲页面还长在 Workspace 里，这不算问题；一旦要独立窗口 / 独立入口 / 按需加载，这就是硬阻碍。

**修法**：新建 `src/constants/outline.ts`，把 `OS_META`（以及 `SideTab` 类型）搬过去，`SidePanel`、`OutlineView`、`ChapterTree` 三处改 import 指向。约 5 行改动，零风险。

**② `onOpenChapter` 的导航语义没有宿主**

现在 `Workspace.tsx:231-234` 里这个回调做了两件事：`actions.selectChapter(id)` + `setMode('write')`。大纲一旦是独立界面，"跳回写作模式"这个动作就没有默认宿主的，必须显式定义。

另外，SidePanel 的 `OutlineTab` 点击章节走的是 `actions.selectChapter(c.id)`，**不切 mode**（它本来就在写作模式）。所以抽出去之后会出现「大纲页选中的章」和「侧栏展开的章」两套独立状态，需要决定是否合并。

**③ `.outline-view` 借用 `--editor-bg`**

`--editor-bg` 在 `:root` 明暗两套主题里都有定义（`global.css:33` / `:49`），所以**不会**出现透明或错色。但语义上它借的是"正文编辑区"底色——独立大纲页若在无 editor 语境渲染，视觉语义不对。

> 这属于**低风险体验项**，不是技术阻碍。修法：给 `.outline-view` 自己的变量或直接用 `var(--bg)`。

### 3.3 不构成阻碍的部分（不用担心）

- **状态管理**：无需 Redux/Context Provider。
- **持久化 / 脏标记**：`store.ts:241-253` 的 `OUTLINE_KEYS` 列表已经在自动判定 `dirtyMeta` → 写 `book.json`。大纲独立界面复用同一套 actions，脏标记逻辑**一行都不用改**。
- **Electron 落盘**：`writeProjectToDir` 由 store 层统一触发，与 UI 形态解耦。
- **CSS 变量**：全部来自 `:root`，主题切换（`document.documentElement.dataset.theme`）自动跟随。

---

## 四、落地方案

### 第一步：结构独立（已完成）

**目标**：把 A 提升为真正独立的路由/页面。

1. 抽 `OS_META` → `src/constants/outline.ts`，四处 import 改指向（并消掉 `project.ts` 重复的 `OUTLINE_STATUS_LABEL`）。
2. `App.tsx` 的路由从"有书/无书"二元，扩成 `bookshelf | write | outline` 三态；路由决策抽成纯函数 `resolveWorkspaceView()`（`src/route.ts`）以便单测覆盖。
3. `mode` 从 Workspace 局部 state 上提到 store 的 `ui`。
4. `Workspace` 拆成 `WorkspaceShell`（顶栏/侧栏/弹窗/落盘）+ `Workspace`（正文区），两个视图共用外壳，**顶栏零复制**。
5. 给 `.outline-view` 补自己的底色变量 `--outline-bg`，不再借正文区底色语义。

### 第二步：规划台（已完成）—— 真正能"先规划完再动笔"

第一步只做到了"结构独立"：**编辑仍然挤在 320px 侧栏里**，而那宽度是为"写正文时瞄一眼"设计的，拿来写设定是折磨。要支持"先写好大纲、设定等等，再去写文章"，得让规划内容有一个自己的宽版主场。

**做法**：把 `SidePanel` 的四个 tab 内容组件（`OutlineTab` / `CharactersTab` / `SettingsTab` / `ForeshadowTab`）导出，规划台复用同一份组件，渲染在宽版主区。

```
正文台：  [目录树] [正文编辑器]         [侧栏]
规划台：  [目录树] [规划主区：5 个标签]  （无侧栏）
                    ├ 总览   全书大纲表（拖拽排序 / 纲状态 / 字数）
                    ├ 大纲   总纲 → 卷纲 → 章纲（宽版表单）
                    ├ 角色   角色卡（宽版）
                    ├ 设定   设定卡（宽版）
                    └ 伏笔   埋收时间线 + 伏笔卡（宽版）
```

- 视图状态从 `'write' | 'outline'` 改名为 `'write' | 'plan'`（旧数据里的 `'outline'` 迁移成 `'plan'`）。
- 顶栏两个 tab 改名「正文 / 规划」，与"先规划再写正文"的工作流对齐。
- **目录树保留**：建卷/删章/改名只在 `ChapterTree.tsx` 里，砍掉就功能回退。
- **侧栏在规划台隐藏**：那 4 块规划内容已搬进主区，320px 侧栏在规划台是冗余的。
- 统一搜索（Ctrl+K）命中角色/设定时，在规划台会跳到对应标签并带上搜索词（正文台仍跳侧栏）。

**遗留问题**：规划台和侧栏里仍能编辑同一份章纲（正文台的侧栏还留着"大纲" tab），两处入口并存。真要收敛，下一步是移除正文台侧栏的大纲 tab —— 但那要先确认用户在写正文时不需要随时瞄一眼章纲。

### 第三步（可选）：独立窗口 / 独立应用形态

需要额外处理：`FileMenu`（导出全书大纲 / 全书 Markdown / 设定集）、`SearchModal` 全文搜索、`UnifiedSearch`（Ctrl+K）、`HelpModal`、更新提示 toast、`StatsBar` —— 这些目前**全部挂在外壳上**。

- 独立窗口：**不建议**。state 是模块级单例，同进程开第二个窗口能共享数据，但会引入跨窗口同步、焦点、目录绑定等一堆复杂度，收益不对称。
- 独立页面（同窗口内）：**已实现**。上述入口保持挂在外壳，规划台按需复用。

---

## 五、必须同步改的回归点

| 位置 | 内容 |
|---|---|
| `electron/verify.cjs:249-271` | E2E 用 `.seg-btn` 找「大纲」按钮、断言 `.ov-row` / `.os-dot` / `.ov-select`，并校验 `12-outline-view.png` 截图。已加 `standalone` 断言：大纲页须有 `.outline-view`、无 `.editor-pane`、且 `.tree` 与 `.side` 都在 |
| `electron/verify.cjs:235-247` | E2E 依赖 `.ol-field` / `.ol-seg-btn`（SidePanel OutlineTab）。大纲页保留侧栏后这些断言在两个视图下都成立 |
| `src/components/FileMenu.tsx:171` | 「导出全书大纲 Markdown」由 `exportOutlineMd` 读 store，与 UI 无关，无需改动 |

> **已实跑**：`npm run e2e`（= `npm run build && electron electron/verify.cjs`）全绿，退出码 0，
> `CONSOLE ERRORS: none`。其中关键断言：
> `E2E outline page -> rows: 1 | revised: true | standalone: true | coverage: 100% | back to editor: true`。
> 唯一瑕疵是 `21-relation-graph.png` 截图被跳过（`capturePage()` 偶发拿不到 display surface，
> 脚本自身已 try/catch 兜住），对应的功能断言 `graph nodes: 4` 通过。

---

## 六、建议

**先做第一步，独立界面完全可行且成本低。**

理由：`OutlineView` 的依赖面比预想中干净得多（86 行、5 个 import、无内部实现引用），全局 store 单例让数据层零改动。真正被低估的是**"大纲"在产品上有三个含义**（总纲/卷纲/章纲）却只有两套 UI——抽界面对这件事没有任何帮助，它只是给 A 这张表一个更大的壳。

如果痛点是"大纲改起来别扭、字段藏太深"，那真正该做的是**第二步的 B1 合并**，而不是抽页面。

---

## 七、复查中发现的其他问题（不属于本次重构，但值得跟进）

| 严重度 | 问题 | 位置 |
|---|---|---|
| 阻塞 | **浏览器版未落盘作品的正文会被永久销毁**：`writeNow()` 对所有书都剥离正文，但浏览器版没有 `projectPath`、也不会 hydrate，localStorage 是正文的唯一副本 → 刷新即丢 | `store.ts` `writeNow()` |
| 建议 | **两套写盘器互相覆盖**：外壳 900ms 全量 `writeProjectToDir` 与 store 200ms 增量 `flushOnce` 写同一批文件，每次编辑写两遍，且全量写进行中若增量写落在其后，磁盘会短暂回退 | `WorkspaceShell.tsx` / `store.ts` `flushOnce` |
| 建议 | **`view` 是死字段**：启动恒落书架、进书恒重置为 `write`，持久化的 `view` 永不会被读取 | `store.ts` `migrate` / `openBook` |
| 建议 | **切视图丢撤销栈**：切到大纲页会卸载 Editor，`past/future` 随之销毁，切回来 Ctrl+Z 无历史（旧版的 mode 切换同样如此，非本次引入） | `Editor.tsx` |
| 建议 | **`useContentHydrated` 是死代码**：定义了却无任何组件使用，注释说的"避免 hydrate 覆盖用户刚输入的字"并未生效——Electron 启动回填期间若用户已输入，回填结果会覆盖掉 | `store.ts:134` / `Editor.tsx` |