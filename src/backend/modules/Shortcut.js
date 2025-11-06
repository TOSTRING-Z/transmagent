const { utils } = require('./globals');
const { captureMouse } = require('../mouse/capture_mouse');

const { globalShortcut } = require('electron');

class Shortcut {
    constructor(windowManager) {
        this.windowManager = windowManager;
    }
    init() {
        if (globalShortcut.isRegistered(utils.getConfig("short_cut"))) {  
            console.log(`${utils.getConfig("short_cut")} 快捷键已注册`);  
        }
        globalShortcut.register(utils.getConfig("short_cut"), () => {
            captureMouse()
                .then((mousePosition) => {
                    console.log(mousePosition);
                    this.windowManager.iconWindow.create(mousePosition);
                })
                .catch((error) => {
                    console.error(error);
                });
        });
    }
}
 

module.exports = {
    Shortcut
};