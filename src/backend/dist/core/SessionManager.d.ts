import { BrowserWindow } from "electron";
import { AgentMode, ChatState } from "../types";
import { ChainCall } from "./ChainCall";
import { LLMService } from "./LLMService";
import { Plugins } from "./Plugins";
import { ToolCall } from "./ToolCall";
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
export declare class SessionManager {
    static instance: SessionManager;
    private activeSessionId;
    private activeSession;
    private window;
    private sessions;
    constructor(window: BrowserWindow);
    getAgentMode(sessionId?: string): AgentMode;
    setActiveagentMode(agentMode: AgentMode): void;
    getChat(sessionId?: string): ChatState | null;
    setChat(chat: Partial<ChatState>, sessionId?: string): void;
    toggleContextMessage(arg0: {
        context_id: any;
        del_mode: boolean;
    }, sessionId?: string): void;
    stopLoop(sessionId?: string): void;
    createSession(): {
        tool_call: ToolCall;
        chain_call: ChainCall;
        llmService: LLMService;
        utils: Utils;
        plugins: Plugins;
        subAgent: SubAgent;
    };
    addSession(): void;
    checkoutSession(id: string): any;
    getSession(id?: string): Session | null;
    getActiveSession(): Session;
}
