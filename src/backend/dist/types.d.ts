export interface ThinkingContent {
    type: "thinking" | "redacted_thinking";
    thinking: string;
}
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
export interface ToolResultContent {
    type: "tool_result";
    tool_call_id?: string | null;
    tool_use_id?: string | null;
    content: string;
}
export type MessageContent = TextContent | ImageContent | ToolResultContent;
export type AgentMode = 'transagent' | 'baseagent' | 'multagent';
export interface OpenAIContent {
    role: "system" | "user" | "assistant" | "tool";
    content: string | MessageContent[];
    reasoning_content?: string;
    tool_call_id?: string | null;
    tool_calls?: ToolCall[];
}
export interface OllamaContent {
    role: "system" | "user" | "assistant";
    content: string;
    reasoning_content?: string;
    tool_call_id?: string | null;
    images?: string[];
}
export interface Skill {
    name: string;
    description: string;
    instructions: string;
    path: string;
}
export interface ToolCall {
    id: string;
    type: string;
    function: {
        name: string;
        arguments: string | object;
    };
}
export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: object;
    };
}
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
export interface BaseMessage {
    group_id?: string;
    context_id?: string;
    show?: boolean;
    react?: boolean;
    del?: boolean;
    thumb?: number;
}
export interface SystemMessage extends BaseMessage {
    role: "system";
    content: string;
}
export interface AssistantMessage extends BaseMessage {
    role: "assistant";
    content: string;
    reasoning_content?: string;
    thinking_signature?: string;
    thinking?: string;
    tool_calls?: ToolCall[];
}
export interface UserMessage extends BaseMessage {
    role: "user";
    content: string | MessageContent[];
}
export interface ToolMessage extends BaseMessage {
    role: "tool";
    content: string | ToolResultContent[];
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
    thinking_signature?: string;
    tool_calls?: ToolCall[];
    tokens?: number;
    is_incremental_tokens?: boolean;
    finish_reason?: string;
}
