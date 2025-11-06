const { app } = require('electron');
const { install } = require('./modules/Install');
install();

const { WindowManager } = require("./modules/WindowManager");
const { Shortcut } = require('./modules/Shortcut');

const windowManager = new WindowManager();
const shortcut = new Shortcut(windowManager);

/* app生命周期 */

app.on('ready', () => {
    windowManager.mainWindow.create();
    windowManager.mainWindow.setup();
    windowManager.iconWindow.setup();
    windowManager.alertWindow.setup();
    windowManager.configWindow.setup();
    windowManager.modelWindow.setup();
    windowManager.overlayWindow.setup();
    windowManager.subAgentWindow.setup();
    shortcut.init();
})