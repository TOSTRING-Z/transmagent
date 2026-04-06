import { BrowserWindow } from "electron";
import { AgentMode, ChatState } from "../types";
import { store } from "../utils/globals";
import { ChainCall } from "./ChainCall";
import { LLMService } from "./LLMService";
import { Plugins } from "./Plugins";
import { ToolCall } from "./ToolCall";
import { WindowManager } from "../main/windows/WindowManager";
import { Utils } from "../utils/Utils";
import { SubAgent } from "./SubAgent";

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

    getAgentMode(sessionId?: string): AgentMode {
        const session: Session = this.sessions.get(sessionId || this.activeSessionId);
        return session.tool_call.agentConfigs.agent_mode;
    }

    setActiveagentMode(agentMode: AgentMode) {
        store.set('agentMode', agentMode);
        const session = this.createSession();
        if (this.activeSessionId)
            this.sessions.set(this.activeSessionId, session);
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

    toggleContextMessage(arg0: { context_id: any; del_mode: boolean; }, sessionId?: string) {
        const session: Session = this.sessions.get(sessionId || this.activeSessionId);
        if (session) {
            const { context_id, del_mode } = arg0;
            session.llmService.chatManager.toggleContextMessage({ context_id, del_mode });
        }
    }

    stopLoop(sessionId?: string) {
        const session: Session = this.sessions.get(sessionId || this.activeSessionId);
        if (session) {
            session.llmService.stopLoop();
        }
    }

    createSession() {
        let agentTools = {};
        let mcp_server = true;
        let skill = true;
        let agentMode: AgentMode = store.get('agentMode', 'transagent');
        
        const utils = new Utils(agentMode);
        
        const plugins = new Plugins(utils);
        plugins.loadInit();
        const llmService = new LLMService([], this.window, utils);
        let subAgent = new SubAgent(utils, llmService);

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
            agent_mode: agentMode,
            agent_name: "TransMAgent"
        });

        const chain_call = new ChainCall(plugins, llmService, this.window, utils);
        return { tool_call, chain_call, llmService, utils, plugins, subAgent };
    }

    addSession() {
        const session = this.createSession();
        const id = `session_${Date.now()}`;
        this.activeSessionId = id;
        this.activeSession = session;
        this.sessions.set(id, session);
    }

    checkoutSession(id: string) {
        if (this.sessions.has(id)) {
            this.activeSessionId = id;
            return this.sessions.get(id);
        } else {
            this.addSession();
            return this.sessions.get(this.activeSessionId!);
        }
    }

    getSession(id?: string): Session | null {
        return this.sessions.get(id || this.activeSessionId) || null;
    }

    getActiveSession(): Session {
        return this.activeSession;
    }
}