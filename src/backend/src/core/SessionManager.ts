import { BrowserWindow } from "electron";
import { AgentMode, ChatState } from "../types";
import { store } from "../utils/globals";
import { ChainCall } from "./ChainCall";
import { LLMService } from "./LLMService";
import { Plugins } from "./Plugins";
import { Observation, ToolCall } from "./ToolCall";
import { Utils } from "./Utils";
import { SubAgent } from "./SubAgent";
import { delHistoryChat, getHistoryChat, getSessionId, setHistory } from "../utils/public";
import { State } from "./ReActAgent";

export interface Session {
    tool_call: ToolCall;
    chain_call: ChainCall;
    llmService: LLMService;
    utils: Utils;
    plugins: Plugins;
    subAgent: SubAgent;
}

export class SessionManager {
    public static instance: SessionManager;
    private activeSessionId!: string;
    private activeSession!: Session
    private window!: BrowserWindow;
    private sessions!: Map<string, any>;

    constructor(window: BrowserWindow) {
        if (!SessionManager.instance) {
            SessionManager.instance = this;
            this.window = window;
            this.sessions = new Map<string, Session>();
            this.updateSession();
        }
        return SessionManager.instance;
    }

    /* 委托方法 */

    getAgentMode(sessionId?: string): AgentMode {
        const session: Session = this.sessions.get(sessionId || this.activeSessionId);
        return session.tool_call.agentConfigs.agentMode;
    }

    getChat(id?: string): ChatState | undefined {
        if (id) {
            // 检查当前会话列表中是否存在该ID
            if (id in this.sessions) {
                const session: Session = this.sessions.get(id);
                return session.llmService.chatManager.chat
            } else {
                // 读取本地文件
                const chat = getHistoryChat(id);
                return chat;
            }
        }
        else {
            const session: Session = this.sessions.get(this.activeSessionId);
            return session.llmService.chatManager.chat;
        }
    }

    setChat(chat: ChatState) {
        // 检查当前会话列表中是否存在该ID
        if (chat.id in this.sessions) {
            const session: Session = this.sessions.get(chat.id);
            session.llmService.chatManager.chat = chat;
        } else {
            // 保存本地文件
            setHistory(chat);
        }
    }

    delChat(id: string) {
        // 检查当前会话列表中是否存在该ID
        if (id in this.sessions) {
            this.sessions.delete(id);
        }
        // 移除本地文件
        delHistoryChat(id);
    }

    setSessionChat(chat: Partial<ChatState>, id?: string) {
        const session: Session = this.sessions.get(id || this.activeSessionId);
        if (session) {
            Object.keys(chat).forEach(key => {
                const value = chat[key];
                if (value !== undefined) {
                    session.llmService.chatManager.chat[key] = value;
                }
            });
        }
    }

    /* 会话管理 */

    setActiveagentMode(agentMode: AgentMode) {
        store.set('agentMode', agentMode);
        // 替换当前会话
        const session = this.createSession(this.activeSessionId, agentMode);
        this.activeSessionId = this.activeSessionId;
        this.activeSession = session;
        this.sessions.set(this.activeSessionId, session);
        // 加载历史消息
        const history_path = session.utils.getHistoryPath(this.activeSessionId);
        session.tool_call.loadMessage(history_path);
        // 更新模式
        session.llmService.chatManager.chat.agentMode = agentMode;
        // 通知前端更新
        const uuid = session.tool_call.setUUID();
        const chat = session.llmService.chatManager.chat;
        this.window?.webContents.send('handleSetChat', chat);
        this.window?.webContents.send('agentIdle', { group_id: chat.group_id, uuid });
    }

    createSession(id?: string, agentMode?: AgentMode): Session {
        let agentTools = {};
        let mcpTool = true;
        let mcpPrompt = true;
        let skill = true;

        if (!agentMode) {
            agentMode = store.get('agentMode', 'transagent');
            if (id) {
                const utilsTemp = new Utils('transagent');
                const historyData = utilsTemp.getHistoryData();
                const chat = historyData.data.find((item: any) => item.id === id);
                if (chat?.agentMode) {
                    agentMode = chat.agentMode;
                }
            }
        }

        const utils = new Utils(agentMode!);
        const plugins = new Plugins(utils);
        const llmService = new LLMService([], this.window, utils, agentMode);
        const subAgent = new SubAgent(utils, llmService);

        if (agentMode === 'transagent' && utils.getConfig("tool_call")?.subagent) {
            agentTools = { "tool_manager": subAgent.getMainSubAgent()["tool_manager"] };
        }
        if (agentMode === 'multagent') {
            mcpTool = false;
            mcpPrompt = false;
            skill = false;
            agentTools = { ...subAgent.getAgentTools() };
        }

        agentTools["deep_researcher"] = subAgent.getMainSubAgent()["deep_researcher"];

        const tool_call = new ToolCall(plugins, agentTools, llmService, this.window, utils, {
            agentPrompt: null,
            mcpTool: mcpTool,
            mcpPrompt: mcpPrompt,
            todolist: true,
            env: true,
            skill: skill,
            subagent: false,
            agentMode: agentMode!,
            agentName: "TransMAgent"
        });

        const chain_call = new ChainCall(plugins, llmService, this.window, utils);

        return { tool_call, chain_call, llmService, utils, plugins, subAgent };
    }

    updateSession(id?: string) {
        const session = this.createSession(id);
        let sessionId: string;
        if (id) {
            sessionId = id;
        } else {
            sessionId = getSessionId();
            session.llmService.chatManager.chat.id = sessionId;
            const uuid = session.tool_call.setUUID();
            const chat = session.llmService.chatManager.chat;
            this.window?.webContents.send('agentIdle', { group_id: chat.group_id, uuid });
        }
        this.activeSessionId = sessionId;
        this.activeSession = session;
        this.sessions.set(sessionId, session);
        return sessionId;
    }

    checkoutSession(id: string) {
        if (this.sessions.has(id)) {
            this.activeSessionId = id;
            this.activeSession = this.sessions.get(id);
            this.activeSession.tool_call.loadChat(id);
            const state = this.activeSession.tool_call.state;
            const chat = this.activeSession.llmService.chatManager.chat;
            const uuid = this.activeSession.tool_call.setUUID();
            if (state === State.RUNNING) {
                this.window.webContents.send('agentRunning', { ...chat, uuid });
            } else if (state === State.PAUSE) {
                const toolInfo = this.activeSession.tool_call.currentToolInfo;
                const observation = this.activeSession.tool_call.currentObservation;
                const { options } = observation as Observation;
                this.window?.webContents.send('handleOptions', { ...this.activeSession.llmService.chatManager.chat, ...toolInfo, options: options, uuid: uuid });
            } else {
                this.window?.webContents.send('agentIdle', { group_id: chat.group_id, uuid });
            }
        } else {
            this.updateSession(id);
            this.activeSession.tool_call.loadChat(id);
            const chat = this.activeSession.llmService.chatManager.chat;
            const uuid = this.activeSession.tool_call.setUUID();
            this.window?.webContents.send('agentIdle', { group_id: chat.group_id, uuid });
        }
        return this.activeSessionId;
    }

    getSession(id?: string): Session | null {
        return this.sessions.get(id || this.activeSessionId) || null;
    }

    getActiveSession(): Session {
        return this.activeSession;
    }
}