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
    getChat(sessionId?: string): ChatState | null;
    setChat(chat: Partial<ChatState>, sessionId?: string): void;
    setActiveagentMode(agentMode: AgentMode): void;
    createSession(): {
        tool_call: ToolCall;
        chain_call: ChainCall;
        llmService: LLMService;
        utils: Utils;
        plugins: Plugins;
        subAgent: SubAgent;
    };
    addSession(id?: string): string;
    checkoutSession(id: string): string;
    getSession(id?: string): Session | null;
    getActiveSession(): Session;
}
