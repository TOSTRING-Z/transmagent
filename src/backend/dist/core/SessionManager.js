"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const globals_1 = require("../utils/globals");
const ChainCall_1 = require("./ChainCall");
const LLMService_1 = require("./LLMService");
const Plugins_1 = require("./Plugins");
const ToolCall_1 = require("./ToolCall");
const Utils_1 = require("./Utils");
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
            this.updateSession();
        }
        return SessionManager.instance;
    }
    /* 委托方法 */
    getAgentMode(sessionId) {
        const session = this.sessions.get(sessionId || this.activeSessionId);
        return session.tool_call.agentConfigs.agentMode;
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
        // 替换当前会话
        const session = this.createSession(this.activeSessionId, agentMode);
        this.activeSessionId = this.activeSessionId;
        this.activeSession = session;
        this.sessions.set(this.activeSessionId, session);
        // 加载历史消息
        const history_path = this.activeSession.utils.getHistoryPath(this.activeSessionId);
        this.activeSession.tool_call.loadMessage(history_path);
        // 更新模式
        this.activeSession.llmService.chatManager.chat.agentMode = agentMode;
        // 通知前端更新
        const group_id = this.activeSession.llmService.chatManager.chat.group_id;
        let uuid = this.activeSession.tool_call.setUUID();
        this.window?.webContents.send('handleSetChat', this.activeSession.llmService.chatManager.chat);
        this.window?.webContents.send('agentIdle', { group_id, uuid });
    }
    createSession(id, agentMode) {
        let agentTools = {};
        let mcp_server = true;
        let skill = true;
        if (!agentMode) {
            agentMode = globals_1.store.get('agentMode', 'transagent');
            if (id) {
                const utilsTemp = new Utils_1.Utils('transagent');
                const historyData = utilsTemp.getHistoryData();
                const chat = historyData.data.find((item) => item.id === id);
                if (chat?.agentMode) {
                    agentMode = chat.agentMode;
                }
            }
        }
        else {
        }
        const utils = new Utils_1.Utils(agentMode);
        const plugins = new Plugins_1.Plugins(utils);
        const llmService = new LLMService_1.LLMService([], this.window, utils, agentMode);
        const subAgent = new SubAgent_1.SubAgent(utils, llmService);
        if (agentMode === 'transagent' && utils.getConfig("tool_call")?.subagent) {
            agentTools = { "tool_manager": subAgent.getMainSubAgent()["tool_manager"] };
        }
        if (agentMode === 'multagent') {
            mcp_server = false;
            skill = false;
            agentTools = { ...subAgent.getAgentTools() };
        }
        agentTools["deep_researcher"] = subAgent.getMainSubAgent()["deep_researcher"];
        const tool_call = new ToolCall_1.ToolCall(plugins, agentTools, llmService, this.window, utils, {
            agent_prompt: null,
            mcp_server: mcp_server,
            todolist: true,
            env: true,
            skill: skill,
            subagent: false,
            agentMode: agentMode,
            agent_name: "TransMAgent"
        });
        const chain_call = new ChainCall_1.ChainCall(plugins, llmService, this.window, utils);
        return { tool_call, chain_call, llmService, utils, plugins, subAgent };
    }
    updateSession(id) {
        const session = this.createSession(id);
        let sessionId;
        if (id) {
            sessionId = id;
        }
        else {
            sessionId = (0, public_1.getSessionId)();
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
            this.updateSession(id);
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