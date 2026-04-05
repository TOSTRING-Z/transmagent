"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseWindow = void 0;
const WindowManager_1 = require("./WindowManager");
class BaseWindow {
    windowManager;
    window;
    utils;
    constructor(windowManager) {
        this.windowManager = windowManager;
        this.window = null;
        this.utils = () => WindowManager_1.WindowManager.instance.mainWindow.session().utils;
    }
}
exports.BaseWindow = BaseWindow;
//# sourceMappingURL=BaseWindow.js.map