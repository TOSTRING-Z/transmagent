import { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { BaseWindow } from "./BaseWindow";
import { WindowManager } from "./WindowManager";
import { Session, SessionManager } from '../../core/SessionManager';
import { AgentMode } from '../../types';
interface FuncItemNode {
    statu: boolean;
    event?: any;
    click?: () => void;
    [key: string]: any;
}
export declare class MainWindow extends BaseWindow {
    funcItems: Record<string, FuncItemNode>;
    sessionManager: SessionManager;
    main_server: any;
    worker: any;
    last_clipboard_content?: string | null;
    concat?: boolean;
    session: (() => Session);
    constructor(windowManager: WindowManager);
    setActiveAgent(activeAgent: AgentMode): void;
    destroy(): void;
    restart(window: BrowserWindow | null): void;
    setupHeartbeat(): void;
    serverInit(): void;
    create(): void;
    agentLoop(data: any): Promise<void>;
    setup(): void;
    startAgentLoop(data: any): void;
    sendQuery(data: any): void;
    private getClipEvent;
    private getMarkDownEvent;
    private getTextEvent;
    private getReactEvent;
    private initFuncItems;
    private initInfo;
    updateVersionsSubmenu(): void;
    private getModelsSubmenu;
    private getVersionsSubmenu;
    getTemplate(): MenuItemConstructorOptions[];
    setPrompt(filePath?: string | null): void;
    loadPrompt(): void;
    setChain(chainStr: string): void;
    loadChain(): void;
}
export {};
