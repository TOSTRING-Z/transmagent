import { MainWindow } from "./MainWindow";
// 以下假设其他窗口组件后续也会用 TS 重构，这里暂时用 any 或跳过类型检测
const { IconWindow } = require("./IconWindow");
const { AlertWindow } = require("./AlertWindow");
const { OverlayWindow } = require("./OverlayWindow");
const { ConfigWindow } = require("./ConfigWindow");
const { ModelWindow } = require("./ModelWindow");
const { SubAgentWindow } = require("./SubAgentWindow");
const { CodeWindow } = require("./CodeWindow");
const { ToolWindow } = require("./ToolWindow");

export class WindowManager {
    private static instance: WindowManager;
    
    public mainWindow!: MainWindow;
    public iconWindow: any;
    public alertWindow: any;
    public overlayWindow: any;
    public configWindow: any;
    public modelWindow: any;
    public subAgentWindow: any;
    public codeWindow: any;
    public toolWindow: any;

    constructor() {
        if (!WindowManager.instance) {
            this.mainWindow = new MainWindow(this);
            this.iconWindow = new IconWindow(this);
            this.alertWindow = new AlertWindow(this);
            this.overlayWindow = new OverlayWindow(this);
            this.configWindow = new ConfigWindow(this);
            this.modelWindow = new ModelWindow(this);
            this.subAgentWindow = new SubAgentWindow(this);
            
            this.codeWindow = new CodeWindow(this);
            this.codeWindow.setup();
            
            this.toolWindow = new ToolWindow(this);
            this.toolWindow.setup();
            
            WindowManager.instance = this;
        }
        return WindowManager.instance;
    }

    public closeAllWindows() {
        this.overlayWindow?.destroy();
        this.configWindow?.destroy();
        this.modelWindow?.destroy();
        this.iconWindow?.destroy();
        this.alertWindow?.destroy();
        this.subAgentWindow?.destroy();
        this.codeWindow?.destroy();
        this.toolWindow?.destroy();
    }
}