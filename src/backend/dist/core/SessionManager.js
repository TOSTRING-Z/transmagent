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
const public_1 = require("../utils/public");
const ReActAgent_1 = require("./ReActAgent");
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
    /* 委托方法 */
    getAgentMode(sessionId) {
        const session = this.sessions.get(sessionId || this.activeSessionId);
        return session.tool_call.agentConfigs.agent_mode;
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
    /* 会话管理 */
    setActiveagentMode(agentMode) {
        globals_1.store.set('agentMode', agentMode);
        const session = this.createSession();
        if (this.activeSessionId)
            this.sessions.set(this.activeSessionId, session);
    }
    createSession() {
        let agentTools = {};
        let mcp_server = true;
        let skill = true;
        let agentMode = globals_1.store.get('agentMode', 'transagent');
        const utils = new Utils_1.Utils(agentMode);
        const plugins = new Plugins_1.Plugins(utils);
        const llmService = new LLMService_1.LLMService([], this.window, utils);
        const subAgent = new SubAgent_1.SubAgent(utils, llmService);
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
    addSession(id) {
        const session = this.createSession();
        let sessionId;
        if (id) {
            sessionId = id;
        }
        else {
            sessionId = (0, public_1.getSessionId)();
            this.window.webContents.send('clear');
            session.tool_call.initVar();
            session.llmService.chatManager.init(undefined, sessionId);
            const group_id = session.llmService.chatManager.chat.group_id;
            let uuid = session.tool_call.setUUID();
            this.window?.webContents.send('agentIdle', { group_id, uuid });
        }
        this.activeSessionId = sessionId;
        this.activeSession = session;
        this.sessions.set(sessionId, session);
        return sessionId;
    }
    checkoutSession(id) {
        if (this.sessions.has(id)) {
            this.activeSessionId = id;
            this.activeSession = this.sessions.get(id);
            this.activeSession.tool_call.loadChat(id);
            const state = this.activeSession.tool_call.state;
            const group_id = this.activeSession.llmService.chatManager.chat.group_id;
            let uuid = this.activeSession.tool_call.setUUID();
            if (state === ReActAgent_1.State.RUNNING) {
                this.window.webContents.send('agentRunning', { group_id, uuid });
            }
            else if (state === ReActAgent_1.State.PAUSE) {
                const toolInfo = this.activeSession.tool_call.currentToolInfo;
                const observation = this.activeSession.tool_call.currentObservation;
                const { options } = observation;
                this.window?.webContents.send('handleOptions', { ...this.activeSession.llmService.chatManager.chat, ...toolInfo, options: options, uuid: uuid });
            }
            else {
                this.window?.webContents.send('agentIdle', { group_id, uuid });
            }
        }
        else {
            this.addSession(id);
            this.activeSession.tool_call.loadChat(id);
            const group_id = this.activeSession.llmService.chatManager.chat.group_id;
            let uuid = this.activeSession.tool_call.setUUID();
            this.window?.webContents.send('agentIdle', { group_id, uuid });
        }
        return this.activeSessionId;
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