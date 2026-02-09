# TransMAgent Renderer Refactor

本目录包含将 `renderer_old.js` 重构为 TypeScript 模块后的源代码。

## 目录结构

- `main/`: 包含所有的 TypeScript 源代码模块。
  - `main.ts`: 入口文件。
  - `chat.ts`: 聊天逻辑。
  - `ui.ts`: 界面交互。
  - ...
- `package.json`: 项目依赖配置。
- `build.js`: 构建脚本 (基于 esbuild)。
- `tsconfig.json`: TypeScript 配置文件。

## 编译流程

为了将 TypeScript 代码编译为浏览器可用的 `renderer.js`，请按照以下步骤操作：

### 1. 安装依赖

确保您的电脑上安装了 Node.js。在当前目录 (`src/frontend/js/`) 下打开终端，运行：

```bash
npm install
```

这将安装 `esbuild` 和 `typescript`。

### 2. 执行编译

运行以下命令进行一次性编译：

```bash
npm run build
```

编译成功后，会在当前目录下生成 `renderer.js` 文件。此文件即为重构后的最终产物，可直接被 Electron 引用。

### 3. 开发模式 (可选)

如果您正在修改代码并希望实时查看效果，可以运行：

```bash
npm run watch
```

该命令会监听 `main/` 目录下文件的变化，并自动重新编译 `renderer.js`。

## 注意事项

- 编译生成的 `renderer.js` 是一个自包含的 bundle (IIFE格式)，已经打包了所有模块代码。
- 请确保 Electron 的 HTML 文件正确引用了生成的 `renderer.js`。
