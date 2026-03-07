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

// openai内容
export interface OpenAIContent {
    role: "system" | "user" | "assistant" | "tool";
    content: string | MessageContent[];
    tool_call_id?: string | null;
    tool_calls?: any[];
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
    content: string | any;
}

// ToolInfo
export interface ToolInfo {
    thinking: string | null;
    tool: string | null;
    id: string | null;
    params: any;
    error: string | null;
}

export interface Message {
    id?: string;
    context_id?: string | null;
    tool_format?: "openai" | "prompt" | "anthropic" | string;
    role: "system" | "user" | "assistant" | "tool";
    tool_call_name?: string | null;
    tool_call_id?: string | null;
    tool_calls?: any[];
    content: string | MessageContent[];
    show?: boolean;
    react?: boolean;
    del?: boolean;
    thumb?: number; // 1:up, 0:null, -1:down
}

export interface ChatState {
    id: string;
    name: string;
    system_prompt: string | null;
    max_index: number;
    max_context_id: number;
    mode: string;
    tokens: number;
    seconds: number;
    msg_count: number;
    envs: Record<string, any>;
    vars: Record<string, any>;
    model: string;
    version: string;
    tool_format: "openai" | "prompt" | "anthropic";
    is_plugin: boolean;
}

export interface ChatRequestData {
    id: string;
    input: string;
    tool_format: string;
    img_url?: string;
    system_prompt?: string;
    api_url: string;
    api_key?: string;
    version: string;
    params?: any;
    llm_params?: any;
    tools?: any[];
    push_message?: boolean;
    react?: boolean;
    return_response?: boolean;
    end?: boolean;
    memory_length?: number;
    env_message?: Message;
    output?: string | any[] | undefined;
    output_template?: string;
}

export interface StreamChunkResult {
    content: string;
    reasoning_content?: string;
    tool_calls?: any[];
    tokens?: number;
}