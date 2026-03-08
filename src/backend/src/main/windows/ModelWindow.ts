import { BrowserWindow, ipcMain } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
import { utils } from '../../utils/globals';

export class ModelWindow extends BaseWindow {
    constructor(windowManager: WindowManager) {
        super(windowManager);
    }

    public create() {
        if (this.window) {
            this.window.restore();
            this.window.show();
            this.window.focus();
            return;
        }

        this.window = new BrowserWindow({
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
        
        ipcMain.on('minimize-window', () => {
            BrowserWindow.getFocusedWindow()?.minimize()
        })

        ipcMain.on('close-window', () => {
            BrowserWindow.getFocusedWindow()?.close()
        })
    }

    public destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    public setup() {
        ipcMain.handle('get-models', async () => {
            const models: any[] = [];
            const config_models = utils.getConfig("models") || {};

            for (const name in config_models) {
                const versions = config_models[name]["versions"] || [];
                versions.forEach((version: any) => {
                    let llm_params: any = null;
                    if (version?.llm_params && Object.keys(version.llm_params).length > 0) {
                        llm_params = version.llm_params;
                    }
                    models.push({
                        id: utils.hashCode(`${name}-${version.version}`),
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

        ipcMain.handle('save-model', async (_, modelData) => {
            if (!modelData?.name || !modelData?.version) {
                this.windowManager.alertWindow?.show("error", "Model name and version are required.");
                return;
            }

            const config = utils.getConfig();
            const config_models: Record<string, any> = config.models || {};

            // 先从旧位置移除（处理改名场景）
            for (const model_name in config_models) {
                config_models[model_name].versions = config_models[model_name].versions.filter((v: any) => {
                    return utils.hashCode(`${model_name}-${v.version}`) !== modelData.id;
                });
                if (config_models[model_name].versions.length === 0) delete config_models[model_name];
            }

            const newVersionEntry = {
                version: modelData.version,
                llm_params: modelData.params,
                ...(modelData.vision ? { vision: ["image"] } : {}),
                ...(modelData.ollama ? { ollama: true } : {})
            };

            if (!config_models[modelData.name]) {
                config_models[modelData.name] = { api_url: modelData.api_url, api_key: modelData.api_key, versions: [] };
            } else {
                config_models[modelData.name].api_url = modelData.api_url;
                config_models[modelData.name].api_key = modelData.api_key;
            }

            const existingIdx = config_models[modelData.name].versions.findIndex((v: any) => v.version === modelData.version);
            if (existingIdx >= 0) {
                config_models[modelData.name].versions[existingIdx] = newVersionEntry;
            } else {
                config_models[modelData.name].versions.push(newVersionEntry);
            }

            config.models = config_models;
            utils.setConfig(config);
            this.windowManager.alertWindow?.show("success", "Model saved successfully!");
            this.windowManager.mainWindow.updateVersionsSubmenu();
        });

        ipcMain.handle('delete-model', async (_, id) => {
            const config = utils.getConfig();
            const config_models: Record<string, any> = config.models || {};

            for (const name in config_models) {
                config_models[name].versions = config_models[name].versions.filter((v: any) => {
                    return utils.hashCode(`${name}-${v.version}`) !== id;
                });
                if (config_models[name].versions.length === 0) delete config_models[name];
            }

            config.models = config_models;
            utils.setConfig(config);
            this.windowManager.alertWindow?.show("success", "Model deleted successfully!");
            this.windowManager.mainWindow.updateVersionsSubmenu();
        });
    }
}