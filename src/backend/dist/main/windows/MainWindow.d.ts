import { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { BaseWindow } from "./BaseWindow";
import { WindowManager } from "./WindowManager";
import { LLMService } from '../../core/LLMService';
import { ToolCall } from '../../core/ToolCall';
import { ChainCall } from '../../core/ChainCall';
import { Plugins } from '../../core/Plugins';
interface FuncItemNode {
    statu: boolean;
    event?: any;
    click?: () => void;
    [key: string]: any;
}
export declare class MainWindow extends BaseWindow {
    funcItems: Record<string, FuncItemNode>;
    plugins: Plugins;
    llm_service: LLMService;
    tool_call: ToolCall;
    chain_call: ChainCall;
    main_server: any;
    worker: any;
    constructor(windowManager: WindowManager);
    destroy(): void;
    restart(window: BrowserWindow | null): void;
    setupHeartbeat(): void;
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
