const { IconWindow } = require("./IconWindow");
const { AlertWindow } = require("./AlertWindow");
const { MainWindow } = require("./MainWindow");
const { OverlayWindow } = require("./OverlayWindow");
const { ConfigWindow } = require("./ConfigWindow");
const { ModelWindow } = require("./ModelWindow");
const { SubAgentWindow } = require("./SubAgentWindow");

class WindowManager {
    constructor() {
        if (!WindowManager.instance) {
            this.mainWindow = new MainWindow(this);
            this.iconWindow = new IconWindow(this);
            this.alertWindow = new AlertWindow(this);
            this.overlayWindow = new OverlayWindow(this);
            this.configWindow = new ConfigWindow(this);
            this.modelWindow = new ModelWindow(this);
            this.subAgentWindow = new SubAgentWindow(this);
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
        this.subAgentWindow.destroy();
    }
}

WindowManager.instance = null;

module.exports = {
    WindowManager
};