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
import { DemoWindow } from "./DemoWindow";

export class WindowManager {
    public static instance: WindowManager;

    public mainWindow!: MainWindow;
    public alertWindow!: AlertWindow;
    public iconWindow!: IconWindow;
    public overlayWindow!: OverlayWindow;
    public configWindow!: ConfigWindow;
    public modelWindow!: ModelWindow;
    public codeWindow!: CodeWindow;
    public toolWindow!: ToolWindow;
    public subAgentWindow!: SubAgentWindow;
    public confirmationWindow!: ConfirmationWindow;
    public demoWindow!: DemoWindow;

    constructor() {
        if (!WindowManager.instance) {
            WindowManager.instance = this;
            this.mainWindow = new MainWindow(this);
            this.alertWindow = new AlertWindow(this);
            this.iconWindow = new IconWindow(this);
            this.overlayWindow = new OverlayWindow(this);
            this.configWindow = new ConfigWindow(this);
            this.modelWindow = new ModelWindow(this);
            this.codeWindow = new CodeWindow(this);
            this.codeWindow.setup();
            this.toolWindow = new ToolWindow(this);
            this.toolWindow.setup();
            this.confirmationWindow = new ConfirmationWindow(this);
            this.confirmationWindow.setup();
            // Demo 窗口：按需懒创建（首次触发时再 create）
            this.demoWindow = new DemoWindow(this);
        }
        return WindowManager.instance;
    }

    public closeAllWindows() {
        this.overlayWindow.destroy();
        this.configWindow.destroy();
        this.modelWindow.destroy();
        this.iconWindow.destroy();
        this.alertWindow.destroy();
        this.subAgentWindow?.destroy();
        this.codeWindow.destroy();
        this.toolWindow.destroy();
        this.confirmationWindow.destroy();
        this.demoWindow?.destroy();
    }
}