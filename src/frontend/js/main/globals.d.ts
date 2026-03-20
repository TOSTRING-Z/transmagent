export declare const DOM: {
    system_prompt: HTMLTextAreaElement;
    file_upload: HTMLElement;
    act_plan: HTMLElement;
    auto: HTMLElement;
    act: HTMLElement;
    plan: HTMLElement;
    flash: HTMLElement;
    pause: HTMLElement;
    progress_container: HTMLElement;
    progress_bar: HTMLElement;
    input: HTMLTextAreaElement;
    submit: HTMLElement;
    messages: HTMLElement;
    top_div: HTMLElement;
    bottom_div: HTMLElement;
    version: HTMLElement;
    tokens: HTMLElement;
    seconds: HTMLElement;
    envs: HTMLElement;
    btn_save_envs: HTMLElement;
    tasks: HTMLElement;
    btn_save_tasks: HTMLElement;
    history_list: HTMLElement;
    btn_new_chat: HTMLElement;
    renameDialog: HTMLElement;
    renameInput: HTMLInputElement;
    msg_count: HTMLElement;
};
export interface ChatState {
    tokens: number;
    seconds: number;
    id: string | null;
    mode: string;
    version: string | null;
    system_prompt: string | null;
    msg_count?: number;
}
export declare const State: {
    markdown_statu: boolean;
    seconds_timer: any;
    chat: ChatState;
    scroll_top: {
        info: boolean;
        data: boolean;
    };
    react_statu: boolean;
    formData: {
        query: string | null;
        prompt: string | null;
        file_path: string | null;
        img_url: string | null;
    };
};
