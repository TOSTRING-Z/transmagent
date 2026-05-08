import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
export declare class CodeWindow extends BaseWindow {
    private llmServiceCompletion;
    private reactAgentCompletion;
    private llmServiceRefactor;
    private reactAgentRefactor;
    private llmService;
    private autoCompleteEnabled;
    private autoErrorCorrectEnabled;
    constructor(windowManager: WindowManager);
    create(): void;
    openFile(filePath: string): void;
    openContent(content: string): void;
    destroy(): void;
    setup(): void;
    private executeOnLoad;
    private getCodeConfig;
    private cleanupResources;
    private initWindowHandlers;
    private initFileHandlers;
    private initConfigHandlers;
    private initAIHandlers;
}
