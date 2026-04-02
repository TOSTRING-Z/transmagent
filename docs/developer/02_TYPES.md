# 类型定义文档 (types.ts)

## 文件路径
```
src/backend/src/types.ts
```

---

## 1. 内容类型 (Content Types)

### TextContent
纯文本内容类型。

```typescript
export interface TextContent {
    type: "text";
    text: string;
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `type` | `"text"` | 固定值，表示文本内容 |
| `text` | `string` | 文本内容 |

---

### ImageContent
图片内容类型（用于多模态 LLM）。

```typescript
export interface ImageContent {
    type: "image_url";
    image_url: {
        url: string;       // Base64 或 URL
        detail?: string;   // 可选：图片清晰度 "low" | "high" | "auto"
    };
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `type` | `"image_url"` | 固定值，表示图片内容 |
| `image_url.url` | `string` | 图片 URL 或 Base64 编码 |
| `image_url.detail` | `string` | 图片清晰度级别 |

---

## 2. 消息类型 (Message Types)

### MessageContent
消息内容的联合类型。

```typescript
export type MessageContent = TextContent | ImageContent;
```

---

### UserMessage
用户消息。

```typescript
export interface UserMessage {
    role: "user";
    content: string | MessageContent[];
    name?: string;  // 可选：用户名
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `role` | `"user"` | 固定值 |
| `content` | `string \| MessageContent[]` | 消息内容 |
| `name` | `string` | 可选用户名 |

---

### AssistantMessage
助手/AI 消息。

```typescript
export interface AssistantMessage {
    role: "assistant";
    content: string | MessageContent[];
    tool_calls?: ToolCall[];      // 工具调用列表
    tool_call_id?: string;        // 工具调用 ID
    name?: string;
    tool_call_results?: boolean;  // 是否已执行工具调用
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `role` | `"assistant"` | 固定值 |
| `content` | `string \| MessageContent[]` | 回复内容 |
| `tool_calls` | `ToolCall[]` | 可选：AI 请求调用的工具 |
| `tool_call_id` | `string` | 可选：工具调用 ID |
| `tool_call_results` | `boolean` | 是否已执行工具调用 |

---

### ToolMessage
工具执行结果消息。

```typescript
export interface ToolMessage {
    role: "tool";
    content: string;
    tool_call_id: string;
    name?: string;
    tool_name?: string;           // 工具名称
    tool_call_success?: boolean;  // 是否成功
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `role` | `"tool"` | 固定值 |
| `content` | `string` | 工具执行结果 |
| `tool_call_id` | `string` | 关联的工具调用 ID |
| `tool_name` | `string` | 工具名称 |
| `tool_call_success` | `boolean` | 执行是否成功 |

---

### SystemMessage
系统消息（用于配置）。

```typescript
export interface SystemMessage {
    role: "system";
    content: string;
}
```

---

### Message
所有消息类型的联合类型。

```typescript
export type Message = UserMessage | AssistantMessage | ToolMessage | SystemMessage;
```

---

## 3. 工具相关类型 (Tool Types)

### ToolInfo
工具的定义信息。

```typescript
export interface ToolInfo {
    type: "function";
    function: {
        name: string;        // 工具名称
        description: string; // 工具描述
        parameters: {
            type: "object";
            properties: Record<string, any>;
            required?: string[];
        };
    };
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `type` | `"function"` | 固定值 |
| `function.name` | `string` | 工具函数名 |
| `function.description` | `string` | 工具功能描述 |
| `function.parameters` | `object` | JSON Schema 参数定义 |

---

### ToolCall
工具调用请求。

```typescript
export interface ToolCall {
    id: string;           // 调用唯一 ID
    type: "function";
    function: {
        name: string;     // 函数名
        arguments: string; // JSON 格式参数
    };
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | `string` | 调用唯一标识 |
| `type` | `"function"` | 固定值 |
| `function.name` | `string` | 要调用的函数名 |
| `function.arguments` | `string` | JSON 序列化的参数 |

---

### StreamChunkResult
流式响应块。

```typescript
export interface StreamChunkResult {
    type: "content_block_delta" | "message_delta" | "message_start" | "content_block_start";
    index?: number;
    content_block?: {
        type: "text" | "tool_use";
        text?: string;
        name?: string;
    };
    delta?: {
        text?: string;
    };
    message?: {
        id: string;
        role: string;
        content: string;
    };
}
```

---

## 4. 对话相关类型 (Chat Types)

### ChatRequestData
聊天请求数据。

```typescript
export interface ChatRequestData {
    messages: Message[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    model?: string;
    system_prompt?: string;
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `messages` | `Message[]` | 对话历史 |
| `temperature` | `number` | 温度参数 (0-1) |
| `max_tokens` | `number` | 最大 token 数 |
| `stream` | `boolean` | 是否流式输出 |
| `model` | `string` | 模型名称 |
| `system_prompt` | `string` | 系统提示词 |

---

### ChatState
聊天状态枚举。

```typescript
export enum ChatState {
    IDLE = "idle",
    RUNNING = "running",
    PAUSED = "paused",
    FINISHED = "finished",
    ERROR = "error"
}
```

---

## 5. 其他类型

### Skill
技能定义。

```typescript
export interface Skill {
    name: string;
    description: string;
    allowed_tools?: string[];
    trigger_condition?: string;
}
```

---

### LongTermMemory
长期记忆。

```typescript
export interface LongTermMemory {
    id?: number;
    content: string;
    embedding?: number[];
    metadata?: Record<string, any>;
    created_at?: string;
}
```

---

## 6. 下一步

- 查看 `03_ADAPTERS.md` 了解 LLM 适配器如何使用这些类型
