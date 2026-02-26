export interface Message {
    id?: string;
    context_id?: string | null;
    role: "system" | "user" | "assistant" | "tool";
    content: string | any[] | undefined;
    show?: boolean;
    react?: boolean;
    del?: boolean;
    thumb?: number; // 1:up, 0:null, -1:down
    tool_calls?: any[];
}

export interface ChatState {
    id: string;
    name: string;
    system_prompt: string | null;
    max_index: number;
    mode: string;
    tokens: number;
    seconds: number;
    msg_count: number;
    envs: Record<string, any>;
    vars: Record<string, any>;
    model: string;
    version: string;
    tool_format: "openai" | "prompt" | string;
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