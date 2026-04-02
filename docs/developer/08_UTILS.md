# 工具函数模块文档 (Utils)

## 文件路径
```
src/backend/src/utils/
├── logger.ts       # 日志工具
├── globals.ts      # 全局变量与配置
├── Utils.ts        # 通用工具类
├── format.ts       # 字符串格式化
├── stream.ts      # 流式响应处理
├── ToolDSL.ts      # 工具 DSL
└── common-types.ts # 通用类型
```

---

## 1. logger.ts - 日志工具

### 功能概述
统一的日志管理工具，支持开发/生产环境切换。

### 核心方法

#### init() - 初始化
```typescript
static init(logPath: string): void
```
- 设置日志文件路径
- 初始化日志写入流

#### log() - 信息日志
```typescript
static log(...args: any[]): void
```

#### warn() - 警告日志
```typescript
static warn(...args: any[]): void
```

#### error() - 错误日志
```typescript
static error(...args: any[]): void
```

### 日志格式
```typescript
[${timestamp}] [${level}] ${message}
```
示例：
```
[2024-01-01 12:00:00] [INFO] Application started
[2024-01-01 12:00:01] [ERROR] Connection failed
```

### 使用方式
```typescript
import { logger } from './logger';

// 替换 console.log
logger.log('信息日志');
logger.warn('警告日志');
console.error('错误日志'); // 保持不变
```

---

## 2. globals.ts - 全局变量与配置

### 功能概述
管理全局配置和状态，包括：
1. 应用配置存储 (story.json)
2. 系统配置
3. 路径常量
4. 全局状态

### 核心变量

#### store - 应用存储
```typescript
store: {
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    apiKey?: string;
    baseURL?: string;
    mcpServers?: string[];
}
```

#### sysConfig - 系统配置
```typescript
sysConfig: {
    PYTHON_BINS: string[];
    NODE_PATH: string;
    SKILLS_PATH: string;
    CONFIG_PATH: string;
    USER_DATA_PATH: string;
}
```

#### CONSTANTS - 常量定义
```typescript
CONSTANTS: {
    MAX_STEPS: number;        // 最大推理步数
    MAX_HISTORY: number;       // 最大历史长度
    TIMEOUT: number;           // 默认超时
}
```

#### CHAT_CONST - 聊天常量
```typescript
CHAT_CONST: {
    MAX_USER_INPUT_LENGTH: number;
    MAX_ASSISTANT_OUTPUT_LENGTH: number;
}
```

### 关键函数

#### loadConfig() - 加载配置
```typescript
function loadConfig(): void
```
- 从 `~/.transmagent/story.json` 读取配置
- 设置默认值

#### saveConfig() - 保存配置
```typescript
function saveConfig(): void
```

---

## 3. Utils.ts - 通用工具类

### 功能概述
提供各类通用工具方法。

### 工具方法

#### delay() - 延迟
```typescript
static delay(ms: number): Promise<void>
```

#### retry() - 重试
```typescript
static retry(fn: Function, options: RetryOptions): Promise<any>
```
| 选项 | 类型 | 描述 |
|------|------|------|
| `maxAttempts` | `number` | 最大重试次数 |
| `delayMs` | `number` | 重试间隔 |
| `backoff` | `number` | 退避倍数 |

#### parseJSON() - JSON 解析
```typescript
static parseJSON(str: string): any
```
- 容错 JSON 解析
- 支持注释

#### sleep() - 睡眠
```typescript
static sleep(ms: number): Promise<void>
```

---

## 4. format.ts - 字符串格式化

### 功能概述
模板字符串格式化工具。

### formatString() - 格式化字符串
```typescript
export function formatString(template: string, data: Record<string, any>): string
```

### 示例
```typescript
formatString('Hello {name}, you have {count} messages', {
    name: 'Alice',
    count: 5
});
// 结果: 'Hello Alice, you have 5 messages'
```

### 支持语法
| 语法 | 示例 | 说明 |
|------|------|------|
| `{key}` | `{name}` | 简单变量 |
| `{obj.key}` | `{user.name}` | 嵌套属性 |
| `{arr[0]}` | `{items[0]}` | 数组元素 |

---

## 5. stream.ts - 流式响应处理

### 功能概述
处理 LLM 的流式响应（SSE/流式 JSON）。

### 核心函数

#### toAsyncIterable() - 转换为异步迭代器
```typescript
async function* toAsyncIterable(
  nodeReadable: NodeJS.ReadableStream
): AsyncGenerator<Uint8Array>
```
- 将 Node.js 流转换为异步迭代器
- 处理 Buffer 和 string 转换

#### streamJSON() - JSON 流解析
```typescript
async function* streamJSON(
  stream: AsyncIterable<Uint8Array>
): AsyncGenerator<any>
```
- 解析 JSON 流
- 处理 SSE 格式

#### streamSse() - SSE 解析
```typescript
async function* streamSse(
  stream: AsyncIterable<Uint8Array>,
  eventPrefix?: string
): AsyncGenerator<SseEvent>
```
| 字段 | 类型 | 描述 |
|------|------|------|
| `event` | `string` | 事件类型 |
| `data` | `string` | 事件数据 |
| `id` | `string` | 事件 ID |

---

## 6. ToolDSL.ts - 工具 DSL

### 功能概述
领域特定语言，用于组合和条件化工具调用。

### 核心操作符

#### 逻辑操作符
```typescript
const ToolDSL = {
    // 全部为真才返回 true
    all: (...fns) => (ctx) => fns.every(fn => fn(ctx)),
    
    // 任一为真返回 true
    any: (...fns) => (ctx) => fns.some(fn => fn(ctx)),
    
    // 取反
    not: (fn) => (ctx) => !fn(ctx),
    
    // 始终返回 true
    always: () => true
};
```

#### 领域原语 (Primitives)
```typescript
const Primitives = {
    // 检查上下文字段
    hasField: (field) => (ctx) => field in ctx,
    
    // 检查值相等
    eq: (field, value) => (ctx) => ctx[field] === value,
    
    // 检查正则匹配
    matches: (field, pattern) => (ctx) => 
        new RegExp(pattern).test(ctx[field]),
    
    // 检查类型
    isType: (field, type) => (ctx) => 
        typeof ctx[field] === type
};
```

### 使用示例
```typescript
const condition = ToolDSL.all(
    Primitives.hasField('file_path'),
    ToolDSL.not(Primitives.eq('mode', 'readonly'))
);

if (condition(context)) {
    // 执行操作
}
```

---

## 7. common-types.ts - 通用类型

### 功能概述
定义项目通用的类型别名和辅助类型。

### 常用类型
```typescript
// 空值
type Null = null | undefined;

// 可选值
type Optional<T> = T | null;

// Promise 结果
type AsyncResult<T> = Promise<{ success: boolean; data?: T; error?: string }>;
```

---

## 8. 工具函数速查表

| 模块 | 函数 | 用途 |
|------|------|------|
| `logger` | `log()`, `warn()`, `error()` | 日志输出 |
| `globals` | `store`, `sysConfig` | 全局配置 |
| `Utils` | `delay()`, `retry()`, `parseJSON()` | 通用工具 |
| `format` | `formatString()` | 字符串模板 |
| `stream` | `streamJSON()`, `streamSse()` | 流式处理 |
| `ToolDSL` | `all()`, `any()`, `not()` | 条件组合 |

---

## 9. 下一步

- 查看 `09_FRONTEND.md` 了解前端模块
- 查看 `10_SKILLS.md` 了解技能系统
