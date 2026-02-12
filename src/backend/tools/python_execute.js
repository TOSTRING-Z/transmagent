const { spawn } = require('child_process');
const { tmpdir } = require('os');
const { writeFileSync, unlinkSync } = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

function threshold(data, threshold) {
    if (!!data && data?.length > threshold) {
        return "Returned content is too large, please try another solution!";
    } else {
        return data;
    }
}

function main(params) {
    return async ({ code }) => {
        // Create temporary file
        const tempFile = path.join(tmpdir(), `temp_${Date.now()}.py`)
        writeFileSync(tempFile, code)
        console.log(tempFile)

        let terminalWindow = null;
        let child = null;
        // Create terminal window
        terminalWindow = new BrowserWindow({
            width: 800,
            height: 600,
            frame: false, // 隐藏默认标题栏和边框
            transparent: true, // 可选：实现透明效果
            show: false,
            resizable: true, // 允许调整窗口大小
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false // 允许在渲染进程使用Electron API
            }
        });

        terminalWindow.loadFile('src/frontend/terminal.html');

        // 或者你也可以在窗口显示后立即打开开发者工具
        terminalWindow.on('ready-to-show', () => {
            // terminalWindow.webContents.openDevTools();
        });

        // 加载完成后显示窗口，但不获取焦点
        terminalWindow.once('ready-to-show', () => {
            if (params?.show) {
                terminalWindow.show();
            }
        });

        ipcMain.on('minimize-window', () => {
            terminalWindow?.minimize()
        })

        ipcMain.on('close-window', () => {
            child?.kill();
            terminalWindow?.close()
        })

        return new Promise((resolve) => {
            // 强制 Python 输出使用 UTF-8 编码，避免在 Windows 下出现 GBK 乱码
            const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
            child = spawn(params.python_bin, [tempFile], { env });
            
            // 设置流编码为 utf8，确保 data.toString() 总是能正确处理多字节字符
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');

            terminalWindow.webContents.send('terminal-data', `${code}\n`);

            ipcMain.on('terminal-input', (event, input) => {
                if (!input) {
                    child.stdin.end();
                } else {
                    child.stdin.write(`${input}`);
                }
            });
            ipcMain.on('terminal-signal', (event, input) => {
                switch (input) {
                    case "ctrl_c":
                        child.kill();
                        break;

                    default:
                        break;
                }
            });

            let output = "";
            let error = "";

            child.stdout.on('data', (data) => {
                const str = data.toString();
                output += str;
                terminalWindow?.webContents.send('terminal-data', str);
            });

            child.stderr.on('data', (data) => {
                const str = data.toString();
                error += str;
                terminalWindow?.webContents.send('terminal-data', str);
            });

            child.on('close', (code) => {
                unlinkSync(tempFile);
                setTimeout(() => {
                    if (terminalWindow)
                        terminalWindow.close();
                    resolve(JSON.stringify({
                        success: code === 0,
                        output: threshold(output, params.threshold),
                        error: error
                    }));
                }, params.delay_time * 1000);
            });

            terminalWindow.on('close', () => {
                terminalWindow = null;
            })
        });
    }
}

function getPrompt() {
    return `## python_execute

Description: Executes Python 3 scripts in a local environment.
**Capabilities**: Data analysis (pandas/numpy), complex file parsing, and algorithmic logic.
**Critical Constraints**:
1. **Output**: You MUST use \`print()\` to return results to the chat context.
2. **Formatting**: Strict indentation is required. Preserve newlines in the XML.

Parameters:
- code: (Required, String) The valid Python script to execute.

### Usage

**1. Data Analysis (Pandas Example)**
<root>
  <thinking>Loading the CSV to calculate average sales metrics.</thinking>
  <tool_call>
    <name>python_execute</name>
    <parameters>
      <code>
import pandas as pd
df = pd.read_csv('/tmp/data.csv')
print(df.describe())
      </code>
    </parameters>
  </tool_call>
</root>

**2. System/File Logic**
<root>
  <thinking>Calculating the MD5 hash of a file.</thinking>
  <tool_call>
    <name>python_execute</name>
    <parameters>
      <code>
import hashlib
with open('/tmp/target.iso', 'rb') as f:
    print(hashlib.md5(f.read()).hexdigest())
      </code>
    </parameters>
  </tool_call>
</root>`;
}

module.exports = {
    main, getPrompt
};
