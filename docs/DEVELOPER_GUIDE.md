# TransMAgent 开发者指南文档目录

> 本文档用于快速项目交接，帮助交接人员快速理解整个代码以及项目，并能够进行快速的新的开发以及功能的添加。

---

## 📁 文档目录结构

```
docs/
├── DEVELPOER_GUIDE.md          # 本文档 - 文档目录总览
├── 01_PROJECT_OVERVIEW.md       # 项目概述与架构
├── 02_TYPES.md                  # 类型定义详解
├── 03_ADAPTERS.md               # 适配器模块文档
├── 04_CORE.md                   # 核心模块文档
├── 05_TOOLS.md                  # 工具模块文档
├── 06_MAIN.md                   # 主进程与窗口管理
├── 07_DATA.md                   # 数据管理模块
├── 08_UTILS.md                 # 工具函数模块
├── 09_FRONTEND.md               # 前端模块文档
└── 10_SKILLS.md                # 技能系统文档
```

---

## 📋 各文档对应代码文件映射

### 核心模块文档

| 文档 | 对应代码文件 | 描述 |
|------|-------------|------|
| `01_PROJECT_OVERVIEW.md` | `main.ts` | 项目入口，整体架构 |
| `02_TYPES.md` | `types.ts` | 全局类型定义 |
| `03_ADAPTERS.md` | `src/adapters/*.ts` | LLM适配器 |
| `04_CORE.md` | `src/core/*.ts` | ReAct代理、工具调用等核心逻辑 |
| `05_TOOLS.md` | `src/tools/*.ts` | 工具函数实现 |
| `06_MAIN.md` | `src/main/*.ts` | Electron主进程与窗口管理 |
| `07_DATA.md` | `src/data/*.ts` | 记忆管理与数据库 |
| `08_UTILS.md` | `src/utils/*.ts` | 通用工具函数 |
| `09_FRONTEND.md` | `src/frontend/js/main/*.ts` | 前端交互逻辑 |
| `10_SKILLS.md` | `skills/*.md` | 技能配置文件 |

---

## 🔑 快速导航

### 想要了解...

- **LLM调用流程** → 查看 `03_ADAPTERS.md` + `04_CORE.md`
- **工具系统工作原理** → 查看 `04_CORE.md` (ToolCall) + `05_TOOLS.md`
- **窗口管理机制** → 查看 `06_MAIN.md`
- **记忆存储机制** → 查看 `07_DATA.md`
- **前端交互逻辑** → 查看 `09_FRONTEND.md`

---

*最后更新: 2024*
