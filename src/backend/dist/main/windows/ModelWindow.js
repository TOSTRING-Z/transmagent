"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelWindow = void 0;
const electron_1 = require("electron");
const BaseWindow_1 = require("./BaseWindow");
const globals_1 = require("../../utils/globals");
class ModelWindow extends BaseWindow_1.BaseWindow {
    constructor(windowManager) {
        super(windowManager);
    }
    create() {
        if (this.window) {
            this.window.restore();
            this.window.show();
            this.window.focus();
            return;
        }
        this.window = new electron_1.BrowserWindow({
            width: 600,
            height: 600,
            frame: false,
            transparent: true,
            resizable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        this.window.loadFile('src/frontend/model.html');
        this.window.on('closed', () => { this.window = null; });
        electron_1.ipcMain.on('minimize-window', () => {
            electron_1.BrowserWindow.getFocusedWindow()?.minimize();
        });
        electron_1.ipcMain.on('close-window', () => {
            electron_1.BrowserWindow.getFocusedWindow()?.close();
        });
    }
    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }
    setup() {
        electron_1.ipcMain.handle('get-models', async () => {
            const models = [];
            const config_models = globals_1.utils.getConfig("models") || {};
            for (const name in config_models) {
                const versions = config_models[name]["versions"] || [];
                versions.forEach((version) => {
                    let llm_params = null;
                    if (version?.llm_params && Object.keys(version.llm_params).length > 0) {
                        llm_params = version.llm_params;
                    }
                    models.push({
                        id: globals_1.utils.hashCode(`${name}-${version.version}`),
                        name,
                        api_url: config_models[name].api_url,
                        api_key: config_models[name]?.api_key,
                        params: llm_params,
                        version: version.version,
                        vision: !!version?.vision,
                        ollama: version?.ollama
                    });
                });
            }
            return models.sort((a, b) => {
                const nameComp = a.name.localeCompare(b.name);
                return nameComp !== 0 ? nameComp : a.version.localeCompare(b.version);
            });
        });
        electron_1.ipcMain.handle('save-model', async (_, modelData) => {
            if (!modelData?.name || !modelData?.version) {
                this.windowManager.alertWindow?.show("error", "Model name and version are required.");
                return;
            }
            const config = globals_1.utils.getConfig();
            const config_models = config.models || {};
            // 先从旧位置移除（处理改名场景）
            for (const model_name in config_models) {
                config_models[model_name].versions = config_models[model_name].versions.filter((v) => {
                    return globals_1.utils.hashCode(`${model_name}-${v.version}`) !== modelData.id;
                });
                if (config_models[model_name].versions.length === 0)
                    delete config_models[model_name];
            }
            const newVersionEntry = {
                version: modelData.version,
                llm_params: modelData.params,
                ...(modelData.vision ? { vision: ["image"] } : {}),
                ...(modelData.ollama ? { ollama: true } : {})
            };
            if (!config_models[modelData.name]) {
                config_models[modelData.name] = { api_url: modelData.api_url, api_key: modelData.api_key, versions: [] };
            }
            else {
                config_models[modelData.name].api_url = modelData.api_url;
                config_models[modelData.name].api_key = modelData.api_key;
            }
            const existingIdx = config_models[modelData.name].versions.findIndex((v) => v.version === modelData.version);
            if (existingIdx >= 0) {
                config_models[modelData.name].versions[existingIdx] = newVersionEntry;
            }
            else {
                config_models[modelData.name].versions.push(newVersionEntry);
            }
            config.models = config_models;
            globals_1.utils.setConfig(config);
            this.windowManager.alertWindow?.show("success", "Model saved successfully!");
            this.windowManager.mainWindow.updateVersionsSubmenu();
        });
        electron_1.ipcMain.handle('delete-model', async (_, id) => {
            const config = globals_1.utils.getConfig();
            const config_models = config.models || {};
            for (const name in config_models) {
                config_models[name].versions = config_models[name].versions.filter((v) => {
                    return globals_1.utils.hashCode(`${name}-${v.version}`) !== id;
                });
                if (config_models[name].versions.length === 0)
                    delete config_models[name];
            }
            config.models = config_models;
            globals_1.utils.setConfig(config);
            this.windowManager.alertWindow?.show("success", "Model deleted successfully!");
            this.windowManager.mainWindow.updateVersionsSubmenu();
        });
    }
}
exports.ModelWindow = ModelWindow;
//# sourceMappingURL=ModelWindow.js.map