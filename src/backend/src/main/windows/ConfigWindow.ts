import { BrowserWindow, ipcMain } from 'electron';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
import { Plugins }  from '../../core/Plugins';
import { Verifier } from '../../core/Verifier';

export class ConfigWindow extends BaseWindow {
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

        this.window.loadFile('src/frontend/config.html');
        this.window.once('ready-to-show', () => this.window?.show());
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
        ipcMain.handle('get-config', () => this.utils().getConfig());

        ipcMain.handle('set-config', (_, config) => {
            let state = this.utils().setConfig(config);
            this.windowManager.mainWindow.updateVersionsSubmenu();
            
            this.windowManager.alertWindow?.show("success", "config saved, restart to apply");
            this.windowManager.mainWindow.restart(this.windowManager.mainWindow.window);
            return state;
        });

        // ── Quick Verification IPC Handlers ────────────────────────────
        // Unified interface: python_execute and image_vision share the
        // same verify-all flow that probes file/SSH/MCP/python/vision.

        ipcMain.handle('verify-file', async () => {
            // File check sources tool_call.extra_prompt + cli_prompt from config.
            // Empty/null paths are skipped silently.
            const toolCallConfig = this.utils().getConfig('tool_call') || {};
            return await Verifier.verifyPromptFiles(toolCallConfig);
        });

        ipcMain.handle('verify-ssh', async () => {
            const sshConfig = this.utils().getSshConfig();
            return await Verifier.verifySsh(sshConfig);
        });

        ipcMain.handle('verify-mcp', async () => {
            const mcpConfig = this.utils().getConfig('mcp_server');
            return await Verifier.verifyMcp(mcpConfig);
        });

        ipcMain.handle('verify-python', async () => {
            const config = this.utils().getConfig() || {};
            return await Verifier.verifyPython(config?.python_execute?.params);
        });

        ipcMain.handle('verify-vision', async (_, visionConfig: any) => {
            // Prefer the live form payload; otherwise fall back to persisted plugin config.
            const config = this.utils().getConfig() || {};
            const fallbackVisionConfig = {
                plugins: {
                    image_vision: {
                        params: config?.plugins?.image_vision?.params || {}
                    }
                }
            };
            return await Verifier.verifyVision(visionConfig && Object.keys(visionConfig).length ? visionConfig : fallbackVisionConfig);
        });

        ipcMain.handle('verify-all', async (_, params: any) => {
            // Batch verify all configured checks at once
            const toolCallConfig = this.utils().getConfig('tool_call') || {};
            const sshConfig = this.utils().getSshConfig();
            const mcpConfig = this.utils().getConfig('mcp_server');
            return await Verifier.verifyAll({
                toolCallConfig,
                sshConfig,
                mcpConfig,
                pythonConfig: this.utils().getConfig()?.python_execute?.params || {},
                visionConfig: params?.visionConfig && Object.keys(params.visionConfig).length
                    ? params.visionConfig
                    : {
                        plugins: {
                            image_vision: {
                                params: this.utils().getConfig()?.plugins?.image_vision?.params || {}
                            }
                        }
                    }
            });
        });
    }
}