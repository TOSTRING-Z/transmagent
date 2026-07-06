// @ts-nocheck
// 演示模式数据结构定义 (空骨架 - 已彻底移除内置固定案例)
// 演示数据现在 100% 由后端 SessionManager 通过 IPC 推送,
// 任何内置示例/兜底数据都已被移除。

export interface DemoMessage {
  role: 'user' | 'system' | 'tool';
  icon?: string;
  content: string;
  delay?: number;          // 单条覆盖默认间隔 (ms)
  info?: string;           // tool 角色附加的工具调用信息
  reasoning?: string;      // system 角色的思考过程 (演示时不显示)
}

export interface DemoScript {
  title: string;
  scenario: string;
  totalDurationHint: string;
  messages: DemoMessage[];
}

// 空占位脚本 - 仅在数据完全空时给一个空骨架,避免 NullPointer
// 永远不应该被实际播放,只是类型系统的兜底
export const EMPTY_SCRIPT: DemoScript = {
  title: '',
  scenario: '',
  totalDurationHint: '',
  messages: [],
};

// ❌ 已彻底移除的内置固定案例 (T-10 commit):
// - BUILT_IN_SCRIPT  (单细胞转录组细胞类型注释 · 8 条消息)
// - TF_NETWORK_SCRIPT (TF 调控网络推断 · 6 条消息)
// 演示数据现在 100% 来自后端 SessionManager.getChat().messages