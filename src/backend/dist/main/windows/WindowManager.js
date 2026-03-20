"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WindowManager = void 0;
const MainWindow_1 = require("./MainWindow");
const AlertWindow_1 = require("./AlertWindow");
const IconWindow_1 = require("./IconWindow");
const OverlayWindow_1 = require("./OverlayWindow");
const ConfigWindow_1 = require("./ConfigWindow");
const ModelWindow_1 = require("./ModelWindow");
const CodeWindow_1 = require("./CodeWindow");
const ToolWindow_1 = require("./ToolWindow");
const SubAgentWindow_1 = require("./SubAgentWindow");
class WindowManager {
    static instance;
    mainWindow;
    alertWindow;
    iconWindow;
    overlayWindow;
    configWindow;
    modelWindow;
    codeWindow;
    toolWindow;
    subAgentWindow;
    constructor() {
        if (!WindowManager.instance) {
            this.mainWindow = new MainWindow_1.MainWindow(this);
            this.alertWindow = new AlertWindow_1.AlertWindow(this);
            this.iconWindow = new IconWindow_1.IconWindow(this);
            this.overlayWindow = new OverlayWindow_1.OverlayWindow(this);
            this.configWindow = new ConfigWindow_1.ConfigWindow(this);
            this.modelWindow = new ModelWindow_1.ModelWindow(this);
            this.subAgentWindow = new SubAgentWindow_1.SubAgentWindow(this);
            this.codeWindow = new CodeWindow_1.CodeWindow(this);
            this.codeWindow.setup();
            this.toolWindow = new ToolWindow_1.ToolWindow(this);
            this.toolWindow.setup();
            WindowManager.instance = this;
        }
        return WindowManager.instance;
    }
    closeAllWindows() {
        this.overlayWindow.destroy();
        this.configWindow.destroy();
        this.modelWindow.destroy();
        this.iconWindow.destroy();
        this.alertWindow.destroy();
        this.subAgentWindow?.destroy();
        this.codeWindow.destroy();
        this.toolWindow.destroy();
    }
}
exports.WindowManager = WindowManager;
//# sourceMappingURL=WindowManager.js.map