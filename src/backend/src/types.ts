// 文本内容
export interface TextContent {
    type: "text";
    text: string;
}

// 图片内容
export interface ImageContent {
    type: "image_url";
    image_url: {
        url: string;
        // 可选的其他图片参数
        detail?: "low" | "high" | "auto";
    };
}

// 联合类型
export type MessageContent = TextContent | ImageContent;

export type AgentMode = 'transagent' | 'baseagent' | 'multagent'

// openai内容
export interface OpenAIContent {
    role: "system" | "user" | "assistant" | "tool";
    content: string | MessageContent[];
    tool_call_id?: string | null;
    tool_calls?: ToolCall[];
}

// ollama内容
export interface OllamaContent {
    role: "system" | "user" | "assistant";
    content: string;
    tool_call_id?: string | null;
    images?: string[]; // base64图片数据数组
}

// observation
export interface ToolResult {
    type: "tool_result";
    tool_call_id?: string | null;
    content: string | MessageContent[];
}

// skill
export interface Skill {
    name: string;
    description: string;
    instructions: string;
    path: string;
}


// Tool Call 类型
export interface ToolCall {
    id: string;
    type: string;
    function: {
        name: string;
        arguments: string | object;
    };
}

// Tool
export interface OpenAITool {
    type: 'function',
    function: {
        name: string,
        description: string,
        parameters: object,
    }
}

// ToolInfo
export interface ToolInfo {
    reasoning_content?: string | null;
    content: string | null;
    tool_call_name: string | null;
    tool_call_id: string | null;
    params: Record<string, any> | any;
    error: string | null;
}

export interface LongTermMemory {
    role: "system" | "assistant" | "user" | "tool";
    content: string;
    context_id: string;
}
// 1. 定义公共基础接口

export interface BaseMessage {
    group_id?: string;
    context_id?: string;
    show?: boolean;
    react?: boolean;
    del?: boolean;
    thumb?: number; // 1:up, 0:null, -1:down
}

// 2. 继承基础接口
export interface SystemMessage extends BaseMessage {
    role: "system";
    content: string;
}

export interface AssistantMessage extends BaseMessage {
    role: "assistant";
    content: string;
    reasoning_content?: string;
    tool_calls?: ToolCall[];
}

export interface UserMessage extends BaseMessage {
    role: "user";
    content: string | MessageContent[];
}

export interface ToolMessage extends BaseMessage {
    role: "tool";
    content: string;
    tool_call_id: string;
    tool_call_name: string;
}

export type Message = SystemMessage | AssistantMessage | UserMessage | ToolMessage;

export interface ChatState {
    id: string;
    name: string;
    system_prompt: string | null;
    step: number;
    group_id: string;
    context_id: string;
    mode: string;
    tokens: number;
    seconds: number;
    msg_count: number;
    envs: Record<string, any>;
    vars: Record<string, any>;
    model: string;
    version: string;
    api_type: "openai" | "anthropic" | "ollama";
    tool_format: "toolcalls" | "prompt";
    is_plugin: boolean;
    compress_context: boolean;
    memory_length: number;
    long_memory_length: number;
    max_tokens: number;
    agentMode?: 'baseagent' | 'transagent' | 'multagent';
}

export interface ChatRequestData {
    uuid: string;
    input: string;
    id: string;
    api_type: "openai" | "anthropic" | "ollama";
    api_url: string;
    version: string;
    img_url?: string;
    system_prompt?: string;
    api_key?: string;
    params?: any;
    llm_params?: Record<string, any>;
    tools?: OpenAITool[];
    llm_conversation_mode?: boolean;
    react?: boolean;
    end?: boolean;
    env_message?: string;
    todolist_message?: string;
    output?: string | any[] | undefined;
    output_template?: string;
}

export interface StreamChunkResult {
    content: string;
    reasoning_content?: string;
    tool_calls?: ToolCall[];
    tokens?: number;
    is_incremental_tokens?: boolean;
    finish_reason?: string;  // 截断原因：'stop' | 'length' | 'max_tokens' 等
}