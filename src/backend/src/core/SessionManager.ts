import { BrowserWindow } from "electron";
import { AgentMode, ChatState } from "../types";
import { store } from "../utils/globals";
import { ChainCall } from "./ChainCall";
import { LLMService } from "./LLMService";
import { Plugins } from "./Plugins";
import { Observation, ToolCall } from "./ToolCall";
import { Utils } from "../utils/Utils";
import { SubAgent } from "./SubAgent";
import { getSessionId } from "../utils/public";
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
            this.addSession();
        }
        return SessionManager.instance;
    }

    /* 委托方法 */

    getAgentMode(sessionId?: string): AgentMode {
        const session: Session = this.sessions.get(sessionId || this.activeSessionId);
        return session.tool_call.agentConfigs.agentMode;
    }

    getChat(sessionId?: string): ChatState | null {
        const session: Session = this.sessions.get(sessionId || this.activeSessionId);
        return session ? session.llmService.chatManager.chat : null;
    }

    setChat(chat: Partial<ChatState>, sessionId?: string) {
        const session: Session = this.sessions.get(sessionId || this.activeSessionId);
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
    }

    createSession(id?: string): Session {
        let agentTools = {};
        let mcp_server = true;
        let skill = true;
        let agentMode: AgentMode = store.get('agentMode', 'transagent');

        if (id) {
            const utilsTemp = new Utils('transagent');
            const historyData = utilsTemp.getHistoryData();
            const chat = historyData.data.find((item: any) => item.id === id);
            if (chat?.agentMode) {
                agentMode = chat.agentMode;
            }
        }

        const utils = new Utils(agentMode);
        const plugins = new Plugins(utils);
        const llmService = new LLMService([], this.window, utils, agentMode);
        const subAgent = new SubAgent(utils, llmService);

        if (agentMode === 'transagent' && utils.getConfig("tool_call")?.subagent) {
            agentTools = { "tool_manager": subAgent.getMainSubAgent()["tool_manager"] };
        }
        if (agentMode === 'multagent') {
            mcp_server = false;
            skill = false;
            agentTools = { ...subAgent.getMainSubAgent() };
        }

        agentTools["deep_researcher"] = subAgent.getMainSubAgent()["deep_researcher"];

        const tool_call = new ToolCall(plugins, agentTools, llmService, this.window, utils, {
            agent_prompt: null,
            mcp_server: mcp_server,
            todolist: true,
            env: true,
            skill: skill,
            subagent: false,
            agentMode: agentMode,
            agent_name: "TransMAgent"
        });

        const chain_call = new ChainCall(plugins, llmService, this.window, utils);

        return { tool_call, chain_call, llmService, utils, plugins, subAgent };
    }

    addSession(id?: string) {
        const session = this.createSession(id);
        let sessionId: string;
        if (id) {
            sessionId = id;
        } else {
            sessionId = getSessionId();
            session.llmService.chatManager.chat.id = sessionId;
            const group_id = session.llmService.chatManager.chat.group_id;
            let uuid = session.tool_call.setUUID();
            this.window?.webContents.send('agentIdle', { group_id, uuid });
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
            const group_id = this.activeSession.llmService.chatManager.chat.group_id;
            let uuid = this.activeSession.tool_call.setUUID();
            if (state === State.RUNNING) {
                this.window.webContents.send('agentRunning', { group_id, uuid });
            } else if (state === State.PAUSE) {
                const toolInfo = this.activeSession.tool_call.currentToolInfo;
                const observation = this.activeSession.tool_call.currentObservation;
                const { options } = observation as Observation;
                this.window?.webContents.send('handleOptions', { ...this.activeSession.llmService.chatManager.chat, ...toolInfo, options: options, uuid: uuid });
            } else {
                this.window?.webContents.send('agentIdle', { group_id, uuid });
            }
        } else {
            this.addSession(id);
            this.activeSession.tool_call.loadChat(id);
            const group_id = this.activeSession.llmService.chatManager.chat.group_id;
            let uuid = this.activeSession.tool_call.setUUID();
            this.window?.webContents.send('agentIdle', { group_id, uuid });
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