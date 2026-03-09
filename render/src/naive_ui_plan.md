
# Naive UI 组件替换方案及全局配置计划

## 1. 布局与容器重构
- `div.window-wrapper` / `div.configwindow-wrapper` -> `n-modal` 或带有拖拽功能的自定义组件配合 `n-card`。
- `div.sidebar-container` -> `n-layout-sider`（已有部分实现，需优化）。
- `div.message-list` -> 配合 `n-scrollbar` 的 `n-list` 或自定义容器，消息项使用 `n-list-item`。
- `div.content` -> `n-text` / `n-log`（用于展示代码和长文本）。

## 2. 交互元素替换
- `<button>` / `.btn` -> `n-button`（配置 `type`, `size`）。
- `<input>` / `.input-field` -> `n-input`。
- 下拉菜单 -> `n-select` / `n-dropdown`。
- 开关 / 复选框 -> `n-switch` / `n-checkbox`。
- 图标展示 -> 配合 `n-icon` 使用 FontAwesome 或 Xicons。

## 3. 消息与反馈
- 提示框 -> `n-alert` / `useMessage()`。
- 弹窗 / Overlay -> `n-modal` / `n-drawer`。

## 4. 全局配置计划
- 确保 `App.vue` 或根组件使用了 `n-config-provider`。
- 统一主题配置，避免各组件内部写死颜色和字体。
- 对于 Electron/Tauri 的自定义标题栏，保留其拖拽特性（如 `window-controls`），内部内容完全使用 Naive UI。
