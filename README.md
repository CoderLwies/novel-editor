# 字舟 · 网文小说编辑器

<img src="public/logo.png" alt="字舟 logo" width="96" align="right" />

面向网文连载作者的桌面写作工具。**编辑器优先**——把码字、章节管理、设定集与大纲做扎实，AI 作为叠加层辅助策划与一致性校验。

Electron 桌面应用 · React + Vite + TypeScript · 无后端，数据保存在本地。

---

## 特性

### 写作核心
- **书架**：多作品管理，封面色 / 连载状态 / 月更目标进度一目了然
- **三栏工作台**：卷-章树 · 沉浸编辑器 · 侧栏（大纲 / 角色 / 设定 / 伏笔）
- **码字统计**：实时字数与速度、日更目标、连续更新天数、全书纲覆盖率
- **明暗主题**、可调字号

### 大纲体系
- **卷纲**：概括 / 目标 / 核心冲突
- **结构化章纲**：目标 / 冲突 / 转折 / 结尾钩子 / 视角人物 / 出场角色 / 伏笔挂接 / 纲状态（计划中 · 已写 · 已修）
- **全书大纲表**：拖拽排序、跨卷移动、行内改纲状态、点击回正文
- **伏笔管理**：挂接章节可视化，"已回收但无章节挂接"自动告警
- **导出全书大纲**为 Markdown

### 落盘与导入导出
- 作品可**绑定本地目录**，编辑即自动同步落盘：
  - `book.json`（项目元数据，version 2）
  - `chapters/NNNN_标题.md`（正文 + YAML frontmatter 携带章纲字段）
- **外部编辑器改 md 可回读**：重新导入时 frontmatter 优先合并
- 导入：字舟项目目录 / 单个 TXT·MD（自动拆卷章）；兼容旧版 v1 项目
- 导出：项目包 / 纯 TXT / Markdown / 全书大纲

### AI 辅助（当前仅支持 `deepseek-flash`）
- **拆章纲**：依据总纲 + 卷纲规划新章节，预览多选后建章
- **走向分支**：为单章推演多个剧情分支，一键采用
- **写后回写**：依据正文归纳实际 synopsis / 转折 / 钩子，并按角色名快照出场人物
- **一致性巡检**：有正文仍为"计划中"、挂角未出场、伏笔回收无挂接、空卷等规则检查

走 OpenAI 兼容协议（`POST {baseUrl}/chat/completions`），Base URL 预填 DeepSeek 官方、可改为兼容中转站。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Electron 31（contextIsolation + IPC 文件桥） |
| 前端 | React 18 + Vite 5 + TypeScript |
| 状态 | `useSyncExternalStore` 外部 store + localStorage 持久化 |
| 图标 | lucide-react |
| 打包 | electron-builder |

---

## 快速开始

```bash
# 安装依赖（.npmrc 已配置 npmmirror 镜像）
npm install

# 浏览器开发（热更新）
npm run dev

# Electron 桌面开发
npm run electron:dev

# 构建渲染层
npm run build

# 打包桌面安装包（输出到 release/）
npm run electron:build
```

类型检查：`npm run typecheck`。

---

## 目录结构

```
├── electron/
│   ├── main.cjs        # 主进程：窗口 + 文件系统 IPC 桥
│   ├── preload.cjs     # contextBridge 暴露 window.fsAPI
│   ├── verify.cjs      # 无头 E2E（stub 对话框 + 断言落盘 + 截图）
│   └── capture.cjs     # 界面截图到 .preview/
├── public/
│   └── logo.png        # 应用 logo / favicon / 窗口图标
├── src/
│   ├── ai.ts           # AI 提供层（chatJSON / 提示词 / 一致性巡检）
│   ├── frontmatter.ts  # YAML 子集编解码（章节 md 头部）
│   ├── project.ts      # 落盘格式序列化 + 导入导出
│   ├── store.ts        # 全局 store 与 actions
│   ├── seed.ts         # 示例数据
│   ├── types.ts        # 领域模型
│   └── components/     # 书架 / 工作台 / 侧栏 / 大纲 / AI 弹窗 …
└── .preview/           # 验证截图（git 忽略，本地生成）
```

---

## 落盘格式

绑定目录后结构如下：

```
<作品目录>/
├── book.json                 # format: zizhou-project, version: 2
└── chapters/
    ├── 0001_第一章 标题.md
    └── 0002_第二章 标题.md
```

章节 md 以 frontmatter 携带章纲，正文在其后：

```markdown
---
title: 第一章 标题
outlineStatus: written
synopsis: 一句话概括
goal: 本章目标
turning: 转折点
hook: 结尾钩子
pov: 视角人物
cast: [char_1]
---

正文内容……
```

外部工具直接编辑该 md（含 frontmatter）后，在字舟中重新导入即可回读。

---

## AI 配置

工作台顶栏 → 「AI 接口设置」：

- **Base URL**：默认 `https://api.deepseek.com`，可改为任意 OpenAI 兼容中转
- **API Key**：DeepSeek 密钥（本地免鉴权服务可留空）
- **模型**：固定 `deepseek-flash`（只读）

配置仅存本机 localStorage；请求由桌面端直连所填地址，不经过任何第三方服务器。

---

## 验证

- `npx electron electron/verify.cjs`：无头端到端。stub 目录/保存对话框、清空 localStorage、驱动 DOM、断言磁盘与状态、`capturePage` 截图；内置回环假 AI 服务跑通拆纲/分支/回写/巡检全链路。
- `npx electron electron/capture.cjs`：生成界面截图到 `.preview/`。

---

## 路线图

- [ ] EPUB 导出
- [ ] AI 续写 / 润色 / 章节审查
- [ ] 放开更多模型（当前收敛为 deepseek-flash）
- [ ] 打包图标（.ico）与自动更新

---

## 说明

本项目为可交互原型：数据存本地（localStorage + 可选目录落盘），无账号与云同步。删除作品不可撤销，请注意备份。
