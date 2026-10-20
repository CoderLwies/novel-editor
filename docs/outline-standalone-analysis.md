# 大纲功能能否单独抽成独立界面 —— 分析

> 分支：`analysis/outline-standalone-ui`
> 结论：**可以抽，成本很低。但"抽哪个大纲"才是真问题。**
>
> **状态（第一步已落地）**：常量抽取、路由三态化、大纲页独立化均已实现并通过
> typecheck / 22 项单测 / production build；大纲页已在浏览器中实测（`.ws-body`
> 下只剩 `.outline-view`，目录树与侧栏均不渲染，点章节名可切回写作台）。
> 第二步（`OutlineTab` 归属）尚未动工。

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

### 第一步：低风险抽取（推荐先做）

**目标**：把 A 提升为真正独立的路由/页面，SidePanel 的 OutlineTab 原样不动。

1. 抽 `OS_META` → `src/constants/outline.ts`，三处 import 改指向。
2. `App.tsx` 的路由从"有书/无书"二元，扩成 `bookshelf | write | outline` 三态（当前是 `book ? <Workspace/> : <Bookshelf/>`，见 `App.tsx:19`）。
3. `mode` 从 Workspace 局部 state 上提到 store 的 `ui`（顺带获得"重开应用记住上次视图"的能力）。
4. 给 `.outline-view` 补自己的底色变量。

**代价**：约 100 行改动，无数据结构变更，无数据迁移，风险极低。

**遗留问题**：A / B 两套章纲 UI 仍然并存。这个方案不解决它，只是把 A 放大了。

### 第二步（可选，也是真正的产品决策）

如果目标是"大纲页成为主力工作台"，就必须决定 B 的归属：

- **方案 B1 · 合并**：把 `OutlineTab` 的字段编辑能力并进大纲页，SidePanel 移除大纲 tab。→ 解决双入口打架，但工作量大（涉及 AI 弹窗、chips 联动落点迁移）。
- **方案 B2 · 分工**：大纲页只管"看和排"（表格 + 排序），SidePanel 只管"填和改"（字段编辑）。→ 成本最低，但要在 UI 上说清楚定位。
- **方案 B3 · 双入口共存**：只做第一步，保持现状。→ 零额外成本，容忍一定割裂。

### 独立窗口 / 独立应用形态（如果这是本意）

需要额外处理：`FileMenu`（导出全书大纲 / 全书 Markdown / 设定集）、`SearchModal` 全文搜索、`UnifiedSearch`（Ctrl+K）、`HelpModal`、更新提示 toast、`StatsBar` —— 这些目前**全部挂在 Workspace 上**。

- 独立窗口：**不建议**。state 是模块级单例，同进程开第二个窗口能共享数据，但会引入跨窗口同步、焦点、目录绑定等一堆复杂度，收益不对称。
- 独立页面（同窗口内）：**建议**。上述入口保持挂在 Workspace，大纲页按需复用即可。

---

## 五、必须同步改的回归点

| 位置 | 内容 |
|---|---|
| `electron/verify.cjs:249-269` | E2E 用 `.seg-btn` 找「大纲」按钮、断言 `.ov-row` / `.os-dot` / `.ov-select`，并校验 `12-outline-view.png` 截图。抽取后选择器（`.seg-btn` 文案）变了要同步改，否则端到端验证会静默失败 |
| `electron/verify.cjs:235-247` | E2E 依赖 `.ol-field` / `.ol-seg-btn`（SidePanel OutlineTab），第一步方案下不受影响 |
| `src/components/FileMenu.tsx:171` | 「导出全书大纲 Markdown」由 `exportOutlineMd` 读 store，与 UI 无关，无需改动 |

---

## 六、建议

**先做第一步，独立界面完全可行且成本低。**

理由：`OutlineView` 的依赖面比预想中干净得多（86 行、5 个 import、无内部实现引用），全局 store 单例让数据层零改动。真正被低估的是**"大纲"在产品上有三个含义**（总纲/卷纲/章纲）却只有两套 UI——抽界面对这件事没有任何帮助，它只是给 A 这张表一个更大的壳。

如果痛点是"大纲改起来别扭、字段藏太深"，那真正该做的是**第二步的 B1 合并**，而不是抽页面。