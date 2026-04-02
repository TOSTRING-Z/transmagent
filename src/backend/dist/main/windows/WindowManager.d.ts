import { MainWindow } from "./MainWindow";
import { AlertWindow } from "./AlertWindow";
import { IconWindow } from "./IconWindow";
import { OverlayWindow } from "./OverlayWindow";
import { ConfigWindow } from "./ConfigWindow";
import { ModelWindow } from "./ModelWindow";
import { CodeWindow } from "./CodeWindow";
import { ToolWindow } from "./ToolWindow";
import { SubAgentWindow } from "./SubAgentWindow";
import { ConfirmationWindow } from "./ConfirmationWindow";
export declare class WindowManager {
    static instance: WindowManager;
    mainWindow: MainWindow;
    alertWindow: AlertWindow;
    iconWindow: IconWindow;
    overlayWindow: OverlayWindow;
    configWindow: ConfigWindow;
    modelWindow: ModelWindow;
    codeWindow: CodeWindow;
    toolWindow: ToolWindow;
    subAgentWindow: SubAgentWindow;
    confirmationWindow: ConfirmationWindow;
    constructor();
    closeAllWindows(): void;
}
