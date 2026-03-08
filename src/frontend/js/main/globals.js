export const DOM = {
    system_prompt: document.getElementById("system_prompt"),
    file_upload: document.getElementById("file_upload"),
    act_plan: document.getElementById("act_plan"),
    auto: document.getElementById("auto"),
    act: document.getElementById("act"),
    plan: document.getElementById("plan"),
    flash: document.getElementById("flash"),
    pause: document.getElementById("pause"),
    progress_container: document.getElementById('progress-container'),
    progress_bar: document.getElementById('progress-bar'),
    input: document.getElementById("input"),
    submit: document.getElementById("submit"),
    messages: document.getElementById("messages"),
    top_div: document.getElementById("top_div"),
    bottom_div: document.getElementById("bottom_div"),
    version: document.getElementById("version"),
    tokens: document.getElementById("tokens"),
    seconds: document.getElementById("seconds"),
    auto_opt: document.getElementById("auto_opt"),
    envs: document.getElementById("envs"),
    btn_save_envs: document.getElementById("btn_save_envs"),
    tasks: document.getElementById("tasks"),
    btn_save_tasks: document.getElementById("btn_save_tasks"),
    history_list: document.getElementById("history-list"),
    btn_new_chat: document.getElementById("new-chat"),
    renameDialog: document.getElementById('renameDialog'),
    renameInput: document.getElementById('renameInput'),
    msg_count: document.getElementById("msg_count") || {
        innerText: '0'
    },
};
export const State = {
    markdown_statu: true,
    seconds_timer: null,
    chat: { tokens: 0, seconds: 0, id: null, mode: 'auto', version: null, system_prompt: "" },
    scroll_top: {
        info: true,
        data: true,
    },
    status: {
        auto_opt: false,
    },
    react_statu: false,
    formData: {
        query: null,
        prompt: null,
        file_path: null,
        img_url: null
    }
};
