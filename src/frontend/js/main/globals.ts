export const DOM = {
  system_prompt: document.getElementById("system_prompt") as HTMLTextAreaElement,
  file_upload: document.getElementById("file_upload") as HTMLElement,
  act_plan: document.getElementById("act_plan") as HTMLElement,
  auto: document.getElementById("auto") as HTMLElement,
  act: document.getElementById("act") as HTMLElement,
  plan: document.getElementById("plan") as HTMLElement,
  flash: document.getElementById("flash") as HTMLElement,
  pause: document.getElementById("pause") as HTMLElement,
  progress_container: document.getElementById('progress-container') as HTMLElement,
  progress_bar: document.getElementById('progress-bar') as HTMLElement,
  input: document.getElementById("input") as HTMLTextAreaElement,
  submit: document.getElementById("submit") as HTMLElement,
  messages: document.getElementById("messages") as HTMLElement,
  top_div: document.getElementById("top_div") as HTMLElement,
  bottom_div: document.getElementById("bottom_div") as HTMLElement,
  version: document.getElementById("version") as HTMLElement,
  tokens: document.getElementById("tokens") as HTMLElement,
  seconds: document.getElementById("seconds") as HTMLElement,
  envs: document.getElementById("envs") as HTMLElement,
  btn_save_envs: document.getElementById("btn_save_envs") as HTMLElement,
  tasks: document.getElementById("tasks") as HTMLElement,
  btn_save_tasks: document.getElementById("btn_save_tasks") as HTMLElement,
  history_list: document.getElementById("history-list") as HTMLElement,
  btn_new_chat: document.getElementById("new-chat") as HTMLElement,
  renameDialog: document.getElementById('renameDialog') as HTMLElement,
  renameInput: document.getElementById('renameInput') as HTMLInputElement,
  model_select: document.getElementById('ai-model') as HTMLSelectElement,
  compress_box: document.getElementById('compress-context') as HTMLInputElement,
  msg_count: document.getElementById("msg_count") as HTMLElement || {
    innerText: '0'
  } as any,
};

export interface ChatState {
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
}

export const State = {
  markdown_statu: true,
  chat: { } as ChatState,
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
