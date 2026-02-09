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
  auto_opt: document.getElementById("auto_opt") as HTMLElement,
  envs: document.getElementById("envs") as HTMLElement,
  btn_save_envs: document.getElementById("btn_save_envs") as HTMLElement,
  tasks: document.getElementById("tasks") as HTMLElement,
  btn_save_tasks: document.getElementById("btn_save_tasks") as HTMLElement,
  history_list: document.getElementById("history-list") as HTMLElement,
  btn_new_chat: document.getElementById("new-chat") as HTMLElement,
  renameDialog: document.getElementById('renameDialog') as HTMLElement,
  renameInput: document.getElementById('renameInput') as HTMLInputElement,
  msg_count: document.getElementById("msg_count") as HTMLElement || {
    innerText: '0'
  } as any,
};

export interface ChatState {
  tokens: number;
  seconds: number;
  id: string | null;
  mode: string;
  system_prompt: string;
  msg_count?: number;
}

export const State = {
  markdown_statu: true,
  seconds_timer: null as any,
  chat: { tokens: 0, seconds: 0, id: null, mode: 'auto', system_prompt: '' } as ChatState,
  scroll_top: {
    info: true,
    data: true,
  },
  status: {
    auto_opt: false,
  },
  react_statu: false,
  formData: {
    query: null as string | null,
    prompt: null as string | null,
    file_path: null as string | null,
    img_url: null as string | null
  }
};
