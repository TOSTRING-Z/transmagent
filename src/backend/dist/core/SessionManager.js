"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const globals_1 = require("../utils/globals");
const ChainCall_1 = require("./ChainCall");
const LLMService_1 = require("./LLMService");
const Plugins_1 = require("./Plugins");
const ToolCall_1 = require("./ToolCall");
const Utils_1 = require("../utils/Utils");
const SubAgent_1 = require("./SubAgent");
class SessionManager {
    static instance;
    activeSessionId;
    activeSession;
    window;
    sessions;
    constructor(window) {
        if (!SessionManager.instance) {
            SessionManager.instance = this;
            this.window = window;
            this.sessions = new Map();
            this.addSession();
        }
        return SessionManager.instance;
    }
    getAgentMode(sessionId) {
        const session = this.sessions.get(sessionId || this.activeSessionId);
        return session.tool_call.agentConfigs.agent_mode;
    }
    setActiveagentMode(agentMode) {
        globals_1.store.set('agentMode', agentMode);
        const session = this.createSession();
        if (this.activeSessionId)
            this.sessions.set(this.activeSessionId, session);
    }
    getChat(sessionId) {
        const session = this.sessions.get(sessionId || this.activeSessionId);
        return session ? session.llmService.chatManager.chat : null;
    }
    setChat(chat, sessionId) {
        const session = this.sessions.get(sessionId || this.activeSessionId);
        if (session) {
            Object.keys(chat).forEach(key => {
                const value = chat[key];
                if (value !== undefined) {
                    session.llmService.chatManager.chat[key] = value;
                }
            });
        }
    }
    toggleContextMessage(arg0, sessionId) {
        const session = this.sessions.get(sessionId || this.activeSessionId);
        if (session) {
            const { context_id, del_mode } = arg0;
            session.llmService.chatManager.toggleContextMessage({ context_id, del_mode });
        }
    }
    stopLoop(sessionId) {
        const session = this.sessions.get(sessionId || this.activeSessionId);
        if (session) {
            session.llmService.stopLoop();
        }
    }
    createSession() {
        let agentTools = {};
        let mcp_server = true;
        let skill = true;
        let agentMode = globals_1.store.get('agentMode', 'transagent');
        const utils = new Utils_1.Utils(agentMode);
        const plugins = new Plugins_1.Plugins(utils);
        plugins.loadInit();
        const llmService = new LLMService_1.LLMService([], this.window, utils);
        let subAgent = new SubAgent_1.SubAgent(utils, llmService);
        if (agentMode === 'transagent' && utils.getConfig("tool_call")?.subagent) {
            agentTools = { "tool_manager": subAgent.getMainSubAgent()["tool_manager"] };
        }
        if (agentMode === 'multagent') {
            mcp_server = false;
            skill = false;
            agentTools = { ...subAgent.getMainSubAgent() };
        }
        agentTools["deep_researcher"] = subAgent.getMainSubAgent()["deep_researcher"];
        const tool_call = new ToolCall_1.ToolCall(plugins, agentTools, llmService, this.window, utils, {
            agent_prompt: null,
            mcp_server: mcp_server,
            todolist: true,
            env: true,
            skill: skill,
            subagent: false,
            agent_mode: agentMode,
            agent_name: "TransMAgent"
        });
        const chain_call = new ChainCall_1.ChainCall(plugins, llmService, this.window, utils);
        return { tool_call, chain_call, llmService, utils, plugins, subAgent };
    }
    addSession() {
        const session = this.createSession();
        const id = `session_${Date.now()}`;
        this.activeSessionId = id;
        this.activeSession = session;
        this.sessions.set(id, session);
    }
    checkoutSession(id) {
        if (this.sessions.has(id)) {
            this.activeSessionId = id;
            return this.sessions.get(id);
        }
        else {
            this.addSession();
            return this.sessions.get(this.activeSessionId);
        }
    }
    getSession(id) {
        return this.sessions.get(id || this.activeSessionId) || null;
    }
    getActiveSession() {
        return this.activeSession;
    }
}
exports.SessionManager = SessionManager;
//# sourceMappingURL=SessionManager.js.map