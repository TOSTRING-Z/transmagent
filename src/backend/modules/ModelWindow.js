const { Window } = require("./Window");
const { utils } = require('./globals');

const { BrowserWindow, ipcMain } = require('electron');


class ModelWindow extends Window {
    constructor(windowManager) {
        super(windowManager);
    }

    create() {
        if (this.window) {
            this.window.restore(); // 恢复窗口
            this.window.show();
            this.window.focus();
        } else {
            this.window = new BrowserWindow({
                width: 600,
                height: 600,
                frame: false, // 隐藏默认标题栏和边框
                transparent: true, // 可选：实现透明效果
                resizable: true, // 允许调整窗口大小
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            })

            this.window.loadFile('src/frontend/model.html')
            this.window.on('closed', () => {
                this.window = null;
            })

            ipcMain.on('minimize-window', () => {
                BrowserWindow.getFocusedWindow().minimize()
            })

            ipcMain.on('close-window', () => {
                BrowserWindow.getFocusedWindow().close()
            })
        }
    }

    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    setup() {
        ipcMain.handle('get-models', async () => {
            // 从存储中获取模型数据
            const models = []
            const config_models = utils.getConfig("models");
            for (const name in config_models) {
                const versions = config_models[name]["versions"];
                versions.forEach((version) => {
                    let llm_params = null;
                    if (version?.llm_params && Object.keys(version?.llm_params).length > 0)
                        llm_params = version.llm_params
                    models.push({
                        id: utils.hashCode(`${name}-${version.version}`),
                        name: name,
                        api_url: config_models[name].api_url,
                        api_key: config_models[name]?.api_key,
                        params: llm_params,
                        version: version.version,
                        vision: !!(version?.vision),
                        ollama: version?.ollama
                    })
                });
                versions.sort((a, b) => {
                    if (a.version < b.version) return -1;
                    if (a.version > b.version) return 1;
                    return 0;
                });
            }
            models.sort((a, b) => {
                const nameComparison = a.name.localeCompare(b.name);
                if (nameComparison !== 0) {
                    return nameComparison;
                }
                return a.version.localeCompare(b.version);
            });
            return models;
        });

        ipcMain.handle('save-model', async (event, modelData) => {
            // 检查参数完整性
            if (!modelData?.name || !modelData?.version) {
                this.windowManager.alertWindow.show("error", "Failed to save model, model name and model version must be provided.");
                return;
            }
            // 保存模型数据
            const config = utils.getConfig();
            const config_models = utils.getConfig("models");
            for (const model_name in config_models) {
                config_models[model_name].versions = config_models[model_name].versions.filter(version => {
                    const id = utils.hashCode(`${model_name}-${version.version}`);
                    return id !== modelData.id;
                });
                if (config_models[model_name].versions.length === 0) {
                    delete config_models[model_name];
                }
            }
            const versions = config_models[modelData.name] ? config_models[modelData.name]["versions"] : [];
            const exists = versions.some((version) => {
                return version.version === modelData.version;
            });
            config_models[modelData.name] = {
                api_url: modelData.api_url,
                api_key: modelData?.api_key,
                versions: exists ? versions.map((version) => {
                    const id = utils.hashCode(`${modelData.name}-${version.version}`);
                    if (id === modelData.id) {
                        version = {
                            "version": modelData.version,
                            "llm_params": modelData.params,
                            ...(modelData.vision ? { "vision": ["image"] } : {}),
                            ...(modelData.ollama ? { "ollama": true } : {})
                        }
                    }
                    return version
                }) : [...versions, {
                    "version": modelData.version,
                    "llm_params": modelData.params,
                    ...(modelData.vision ? { "vision": ["image"] } : {}),
                    ...(modelData.ollama ? { "ollama": true } : {})
                }]
            }
            config["models"] = config_models;
            utils.setConfig(config);
            this.windowManager.alertWindow.show("success", "model saved successfully!");
            this.windowManager.mainWindow.updateVersionsSubmenu();
        });

        ipcMain.handle('delete-model', async (event, id) => {
            // 删除指定模型
            const config = utils.getConfig();
            const config_models = utils.getConfig("models");
            for (const name in config_models) {
                let versions = config_models[name].versions;
                config_models[name]["versions"] = versions.filter((version) => {
                    const model_id = utils.hashCode(`${name}-${version.version}`);
                    if (model_id === id) {
                        return false
                    }
                    return true
                })
            }
            for (const model_name in config_models) {
                if (config_models[model_name].versions.length === 0) {
                    delete config_models[model_name];
                }
            }
            config["models"] = config_models;
            utils.setConfig(config);
            this.windowManager.alertWindow.show("success", "model deleted successfully!");
            this.windowManager.mainWindow.updateVersionsSubmenu();
        });
    }

}

module.exports = {
    ModelWindow
};