export interface TextContent {
    type: "text";
    text: string;
}
export interface ImageContent {
    type: "image_url";
    image_url: {
        url: string;
        detail?: "low" | "high" | "auto";
    };
}
export type MessageContent = TextContent | ImageContent;
export interface OpenAIContent {
    role: "system" | "user" | "assistant" | "tool";
    content: string | MessageContent[];
    tool_call_id?: string | null;
    tool_calls?: ToolCall[];
}
export interface OllamaContent {
    role: "system" | "user" | "assistant";
    content: string;
    tool_call_id?: string | null;
    images?: string[];
}
export interface ToolResult {
    type: "tool_result";
    tool_call_id?: string | null;
    content: string | MessageContent[];
}
export interface Skill {
    name: string;
    description: string;
    allowedTools: string[];
    instructions: string;
    path: string;
}
export interface ToolCall {
    id?: string;
    type?: string;
    function?: {
        name: string;
        arguments: string | object;
    };
}
export interface ToolInfo {
    thinking: string | null;
    tool: string | null;
    id: string | null;
    params: Record<string, any> | any;
    error: string | null;
}
export interface Message {
    group_id?: string;
    context_id?: string | null;
    tool_format?: "openai" | "prompt" | "anthropic" | string;
    role: "system" | "user" | "assistant" | "tool";
    tool_call_name?: string | null;
    tool_call_id?: string | null;
    tool_calls?: ToolCall[];
    content: string | MessageContent[];
    show?: boolean;
    react?: boolean;
    del?: boolean;
    thumb?: number;
}
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
    compress_context: boolean;
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
    llm_params?: Record<string, any>;
    tools?: ToolCall[];
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
    tool_calls?: ToolCall[];
    tokens?: number;
    is_incremental_tokens?: boolean;
}
