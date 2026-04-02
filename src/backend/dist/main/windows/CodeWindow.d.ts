import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
export declare class CodeWindow extends BaseWindow {
    private llm_service_completion;
    private react_agent_completion;
    private llm_service_refactor;
    private react_agent_refactor;
    private auto_complete_enabled;
    private auto_error_correct_enabled;
    constructor(windowManager: WindowManager);
    create(): void;
    openFile(filePath: string): void;
    openContent(content: string): void;
    destroy(): void;
    setup(): void;
}
