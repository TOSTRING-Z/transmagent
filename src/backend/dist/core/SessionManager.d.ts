import { BrowserWindow } from "electron";
import { AgentMode, ChatState } from "../types";
import { ChainCall } from "./ChainCall";
import { LLMService } from "./LLMService";
import { Plugins } from "./Plugins";
import { ToolCall } from "./ToolCall";
import { Utils } from "./Utils";
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
    getChat(id?: string): ChatState | undefined;
    setChat(chat: ChatState): void;
    setSessionChat(chat: Partial<ChatState>, id?: string): void;
    setActiveagentMode(agentMode: AgentMode): void;
    createSession(id?: string, agentMode?: AgentMode): Session;
    updateSession(id?: string): string;
    checkoutSession(id: string): string;
    getSession(id?: string): Session | null;
    getActiveSession(): Session;
}
