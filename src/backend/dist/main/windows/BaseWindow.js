"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseWindow = void 0;
const Utils_1 = require("../../utils/Utils");
const globals_1 = require("../../utils/globals");
class BaseWindow {
    windowManager;
    window;
    utils;
    constructor(windowManager) {
        this.windowManager = windowManager;
        this.window = null;
        this.utils = () => windowManager.mainWindow ? windowManager.mainWindow.session().utils : new Utils_1.Utils(globals_1.store.get('agentMode', 'transagent'));
    }
}
exports.BaseWindow = BaseWindow;
//# sourceMappingURL=BaseWindow.js.map