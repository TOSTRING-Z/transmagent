export interface ChatState {
    uuid: string;
    id: string;
    name: string;
    system_prompt: string;
    step: number;
    group_id: string;
    context_id: string;
    mode: string;
    tokens: number;
    seconds: number;
    msg_count: number;
    agentMode: "transagent" | "baseagent" | "multagent";
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
    starred?: boolean;
}

export const State = {
    uuid: null as string | null,
    chat: {} as ChatState,
    scroll_top: {
        info: true,
        data: true,
    },
    react_statu: false,
    formData: {
        query: null as string | null,
        prompt: null as string | null,
        file_path: null as string | null,
        img_url: null as string | null
    }
};