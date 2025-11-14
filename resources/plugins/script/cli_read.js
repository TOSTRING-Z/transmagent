const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { BrowserWindow, ipcMain } = require('electron');
const { Client } = require('ssh2');
const { utils } = require('../modules/globals');

// 允许的安全只读命令白名单
const ALLOWED_COMMANDS = [
    'ls', 'dir', 'pwd', 'cat', 'head', 'tail', 'grep', 'find', 'file',
    'stat', 'wc', 'du', 'df', 'which', 'whereis', 'locate', 'updatedb',
    'readlink', 'realpath', 'basename', 'dirname', 'echo', 'printenv',
    'env', 'whoami', 'id', 'groups', 'uname', 'hostname', 'date', 'cal',
    'ps', 'top', 'htop', 'free', 'uptime', 'w', 'who', 'last', 'history',
    'tree', 'lsblk', 'lscpu', 'lshw', 'lspci', 'lsusb', 'dmidecode',
    'mount', 'df', 'blkid', 'fdisk', 'parted', 'lsmod', 'modinfo',
    'sysctl', 'ulimit', 'getconf', 'getent', 'ldd', 'ldconfig',
    'nm', 'objdump', 'readelf', 'strings', 'hexdump', 'od', 'xxd',
    'base64', 'md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'cksum',
    'sort', 'uniq', 'cut', 'awk', 'sed', 'tr', 'column', 'paste', 'join',
    'split', 'csplit', 'tac', 'rev', 'nl', 'fold', 'fmt', 'pr', 'less', 'more',
    'test', '[', '[[', 'true', 'false', 'null', 'type', 'command', 'hash'
];

// 禁止的危险命令和操作
const FORBIDDEN_PATTERNS = [
    'rm ', 'rmdir ', 'mv ', 'cp ', 'chmod ', 'chown ', 'chgrp ', 'chattr ',
    'setfacl ', 'setfattr ', 'mount ', 'umount ', 'mkfs', 'dd ', 'mkfifo ',
    'mknod ', 'touch ', 'mkdir ', '>', '>>', '1>', '2>', '&>', '| tee ',
    'sudo', 'su ', 'passwd', 'useradd', 'userdel', 'groupadd', 'groupdel',
    'usermod', 'groupmod', 'visudo', 'crontab -e', 'at ', 'batch ',
    'systemctl', 'service ', 'initctl', 'telinit ', 'shutdown', 'reboot',
    'halt', 'poweroff', 'wall ', 'write ', 'mesg ', 'talk ', 'finger ',
    'wget', 'curl', 'scp', 'rsync', 'ssh ', 'sftp ', 'ftp ', 'telnet ',
    'nc ', 'netcat ', 'nmap ', 'tcpdump ', 'wireshark ', 'iptables ',
    'ufw ', 'firewall-cmd ', 'arptables ', 'ebtables ', 'ip ', 'ifconfig ',
    'route ', 'arp ', 'netstat ', 'ss ', 'ping ', 'traceroute ', 'tracepath ',
    'mtr ', 'dig ', 'nslookup ', 'host ', 'whois ', 'awk -i', 'sed -i',
    'perl -i', 'python -c', 'ruby -e', 'node -e', 'php -r', 'lua -e',
    'exec ', 'eval ', 'source ', '. ', 'export ', 'alias ', 'unalias ',
    'declare ', 'typeset ', 'let ', 'readonly ', 'printf ', 'echo -e',
    'xargs ', 'parallel ', 'nohup ', 'disown ', 'bg ', 'fg ', 'jobs ',
    'kill', 'pkill', 'killall', 'timeout ', 'watch ', 'screen ', 'tmux ',
    'script ', 'expect ', 'dialog ', 'whiptail ', 'zenity ', 'kdialog ',
    'notify-send ', 'xmessage ', 'yad ', 'qdbus ', 'gdbus ', 'dbus-send ',
    'pkexec', 'gksu', 'gksudo', 'kdesu', 'kdesudo', 'beesu', 'lxsu ',
    'lxsudo', 'matesu', 'matesudo', 'xfcesu', 'xfcesudo', 'gnomesu ',
    'gnomesudo', 'polkit-agent-helper-1', 'pkttyagent', 'pkaction ',
    'pkcheck', 'pkla-admin', 'pkla-check-authorization', 'pkpasswd-helper ',
    'pkttyagent-polkit', 'polkitd', 'polkit-gnome-authentication-agent-1 ',
    'polkit-kde-authentication-agent-1', 'polkit-mate-authentication-agent-1 ',
    'polkit-xfce-authentication-agent-1', 'accountsservice', 'accounts-daemon ',
    'console-kit-daemon', 'systemd-logind', 'logind', 'upstart-socket-bridge ',
    'upstart-file-bridge', 'dbus-daemon', 'avahi-daemon', 'cupsd', 'smbd ',
    'nmbd', 'winbindd', 'sshd', 'telnetd', 'ftpd', 'tftpd', 'rpcbind ',
    'portmap', 'ypbind', 'autofs', 'automount', 'ld.so', 'ld-linux.so ',
    'ldconfig', 'ldd', 'objdump', 'readelf', 'strings', 'strip ', 'nm ',
    'size ', 'addr2line ', 'c++filt ', 'gprof ', 'ptrace ', 'strace ',
    'ltrace ', 'truss ', 'ktrace ', 'kdump ', 'perf ', 'oprofile ',
    'systemtap ', 'dtrace ', 'coredump ', 'gcore ', 'coredumpctl ',
    'abrt-dump', 'abrt-handle', 'abrt-report', 'abrt-retrace', 'abrt-upload ',
    'apport', 'whoopsie', 'crash', 'kexec', 'makedumpfile', 'crashkernel ',
    'kdump', 'netdump', 'diskdump', 'livedump', 'sadump', 'vmcore-dmesg ',
    'virsh', 'virt-install', 'virt-clone', 'virt-convert', 'virt-image ',
    'virt-p2v', 'virt-v2v', 'virt-xml', 'guestfish', 'guestmount ',
    'guestunmount', 'libguestfs', 'qemu', 'kvm', 'xen', 'docker ', 'podman ',
    'lxc', 'lxd', 'rkt', 'systemd-nspawn', 'unshare', 'nsenter', 'ip netns ',
    'mount -t', 'umount -t', 'fusermount', 'mount.fuse', 'umount.fuse ',
    'sshfs', 'curlftpfs', 'rclone', 'rsync', 'tar ', 'gzip', 'bzip2', 'xz ',
    'lzma', 'lzop', 'lzip', 'lz4', 'zstd', 'zip', 'unzip', 'rar', 'unrar ',
    '7z', '7za', '7zr', 'ar ', 'cpio', 'dump', 'restore', 'mt', 'mtx ',
    'tapeinfo', 'scsitape', 'sg_', 'sdparm', 'hdparm', 'smartctl', 'nvme ',
    'sensors', 'lm-sensors', 'psensor', 'xsensors', 'fancontrol', 'pwmconfig ',
    'sensors-detect', 'acpi', 'upower', 'powertop', 'cpufreq-set', 'cpufreq-info ',
    'radeontop', 'nvidia-smi', 'nvidia-settings', 'nvidia-xconfig', 'aticonfig ',
    'fglrx', 'catalyst', 'amdgpu', 'intel_gpu_top', 'intel_gpu_frequency ',
    'glxinfo', 'glxgears', 'vdpauinfo', 'vainfo', 'clinfo', 'nvidia-cuda-mps-control ',
    'nvidia-cuda-mps-server', 'nvidia-persistenced', 'nvidia-modprobe ',
    'bumblebeed', 'primusrun', 'optirun', 'virtualgl', 'vglrun', 'turbovnc ',
    'tigervnc', 'tightvnc', 'x11vnc', 'vncserver', 'x0vncserver', 'x11vnc ',
    'x2go', 'nx', 'freerdp', 'rdesktop', 'remmina', 'vinagre', 'krfb ',
    'krdc', 'gnome-remote-desktop', 'vino', 'xrdp', 'pulseaudio', 'alsa ',
    'jack', 'pipewire', 'wireplumber', 'pactl', 'pacmd', 'amixer', 'aplay ',
    'arecord', 'speaker-test', 'mpg123', 'mpg321', 'ogg123', 'flac ',
    'wavpack', 'opusenc', 'opusdec', 'lame', 'sox', 'ffmpeg', 'avconv ',
    'mplayer', 'mpv', 'vlc', 'smplayer', 'gnome-mplayer', 'totem ', 'kaffeine ',
    'xine', 'gstreamer', 'gst-launch', 'gst-inspect', 'gst-discoverer ',
    'gst-play', 'gst-device-monitor', 'gst-typefind', 'gst-install ',
    'gst-uninstall', 'gst-register', 'gst-inspect-1.0', 'gst-launch-1.0 ',
    'gst-play-1.0', 'gst-device-monitor-1.0', 'gst-typefind-1.0 ',
    'gst-install-1.0', 'gst-uninstall-1.0', 'gst-register-1.0', 'gst-editor ',
    'gst-validate', 'gst-validate-1.0', 'gst-validate-transcoding-1.0 ',
    'gst-validate-media-check-1.0', 'gst-validate-launcher-1.0 ',
    'gst-validate-reporter-1.0', 'gst-validate-scenario-1.0 '
];

function validateCommandSafety(code) {
    if (!code || typeof code !== 'string') {
        throw new Error('Code parameter is required and must be a string');
    }

    // 检查代码长度
    if (code.length > 10000) {
        throw new Error('Code is too long (max 10000 characters)');
    }

    const lines = code.split('\n').filter(line => line.trim().length > 0);
    
    // 检查行数限制
    if (lines.length > 50) {
        throw new Error('Too many lines of code (max 50 lines)');
    }

    // 检查每行命令
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // 跳过空行和注释
        if (line === '' || line.startsWith('#')) {
            continue;
        }

        // 检查是否包含禁止的模式
        for (const pattern of FORBIDDEN_PATTERNS) {
            if (line.includes(pattern)) {
                throw new Error(`Command contains forbidden operation: ${pattern.trim()}`);
            }
        }

        // 检查命令是否在白名单中
        const firstWord = line.split(' ')[0].toLowerCase();
        const isAllowed = ALLOWED_COMMANDS.some(cmd => 
            firstWord === cmd || line.startsWith(cmd + ' ')
        );

        if (!isAllowed) {
            throw new Error(`Command not allowed: ${firstWord}`);
        }

        // 额外安全检查：防止命令注入
        if (line.includes('`') || line.includes('$(') || line.includes('${')) {
            throw new Error('Command injection detected - backticks and command substitution are not allowed');
        }
    }

    return true;
}

function threshold(data, max_lines = 40, max_chars_per_line = 200) {
    if (!data) return data;

    let lines = data.split('\n');
    let result = '';

    if (lines.length > max_lines) {
        result += `[truncated because the output is too long, showing only last ${max_lines} lines (max ${max_chars_per_line} chars per line)]\n`;
        lines = lines.slice(-max_lines);
    }

    lines.forEach(line => {
        if (line.length > max_chars_per_line) {
            result += line.substring(0, max_chars_per_line) + '...\n';
        } else {
            result += line + '\n';
        }
    });

    return result.trim();
}

function validateParams(params) {
    if (!params) {
        throw new Error('Parameters are required');
    }

    if (typeof params.timeout !== 'number' || params.timeout < 60) {
        params.timeout = 60;
    }

    if (typeof params.delay_time !== 'number' || params.delay_time < 2) {
        params.delay_time = 2;
    }

    if (typeof params.max_lines !== 'number' || params.max_lines < 10) {
        params.max_lines = 10;
    }

    if (typeof params.max_chars_per_line !== 'number' || params.max_chars_per_line < 100) {
        params.max_chars_per_line = 100;
    }

    return params;
}

function cleanupResources(tempFile, terminalWindow, conn = null) {
    try {
        if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    } catch (error) {
        console.warn('Failed to delete temp file:', error.message);
    }

    if (terminalWindow && !terminalWindow.isDestroyed()) {
        terminalWindow.close();
    }

    if (conn) {
        try {
            conn.end();
        } catch (error) {
            console.warn('Failed to close SSH connection:', error.message);
        }
    }
}

function main(params) {
    return async ({ code, timeout }) => {
        // 参数验证
        try {
            params = validateParams(params);
        } catch (error) {
            return {
                success: false,
                output: '',
                error: error.message
            };
        }

        // 代码验证和安全检查
        try {
            validateCommandSafety(code);
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Security validation failed: ${error.message}`
            };
        }

        // 如果传入timeout参数，则覆盖默认值
        if (timeout && typeof timeout === 'number' && timeout > params.timeout) {
            params.timeout = timeout;
        }

        // 创建临时文件
        const tempFile = path.join(os.tmpdir(), `read_only_${Date.now()}.sh`);
        try {
            if (params?.bashrc) {
                code = `source ${params.bashrc};\n${code}`;
            }
            fs.writeFileSync(tempFile, code);
            console.log('Temporary file created:', tempFile);
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to create temporary file: ${error.message}`
            };
        }

        // 创建终端窗口
        let terminalWindow = null;
        try {
            terminalWindow = new BrowserWindow({
                width: 800,
                height: 600,
                frame: false,
                transparent: true,
                resizable: true,
                show: false, // 初始不显示，避免干扰用户
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            });

            terminalWindow.loadFile('src/frontend/terminal.html');

            // 加载完成后显示窗口，但不获取焦点
            terminalWindow.once('ready-to-show', () => {
                if (params?.show) {
                    terminalWindow.show();
                }
            });

            terminalWindow.on('closed', () => {
                terminalWindow = null;
            });
        } catch (error) {
            cleanupResources(tempFile, null);
            return {
                success: false,
                output: '',
                error: `Failed to create terminal window: ${error.message}`
            };
        }

        // 窗口事件监听
        ipcMain.on('minimize-window', () => {
            terminalWindow?.minimize();
        });

        return new Promise((resolve) => {
            let output = "";
            let error = "";
            let timeoutId = null;
            let isResolved = false;

            const finish = (result) => {
                if (isResolved) return;
                isResolved = true;

                if (timeoutId) {
                    clearTimeout(timeoutId);
                }

                cleanupResources(tempFile, terminalWindow, conn);
                resolve(result);
            };

            // 设置超时
            timeoutId = setTimeout(() => {
                console.log(`Command execution timed out after ${params.timeout} seconds`);
                finish({
                    success: false, // 超时状态为失败
                    output: threshold(output, params.max_lines, params.max_chars_per_line),
                    error: threshold(error, params.max_lines, params.max_chars_per_line),
                    timeout: true, // 添加超时标志
                    message: `Command execution timed out after ${params.timeout} seconds, but returning current console output`
                });
            }, params.timeout * 1000);

            // 关闭窗口事件
            ipcMain.once('close-window', () => {
                finish({
                    success: false,
                    output: threshold(output, params.max_lines, params.max_chars_per_line),
                    error: 'Execution cancelled by user'
                });
            });

            const sshConfig = utils.getSshConfig();
            let conn = null;

            if (sshConfig?.enabled) {
                conn = new Client();

                conn.on('ready', () => {
                    console.log('SSH Connection Ready');
                    const remoteScriptPath = `/tmp/read_only_script_${Date.now()}.sh`;

                    conn.sftp((sftpErr, sftp) => {
                        if (sftpErr) {
                            finish({
                                success: false,
                                output: threshold(output, params.max_lines, params.max_chars_per_line),
                                error: `SFTP error: ${sftpErr.message}`
                            });
                            return;
                        }

                        // 上传脚本文件
                        const writeStream = sftp.createWriteStream(remoteScriptPath);
                        writeStream.on('error', (writeErr) => {
                            finish({
                                success: false,
                                output: threshold(output, params.max_lines, params.max_chars_per_line),
                                error: `File upload error: ${writeErr.message}`
                            });
                        });

                        writeStream.write(`#!/bin/bash\n${code}`);
                        writeStream.end();

                        writeStream.on('close', () => {
                            // 执行远程命令
                            conn.exec(`chmod +x ${remoteScriptPath} && ${remoteScriptPath}; rm -f ${remoteScriptPath}`, (execErr, stream) => {
                                if (execErr) {
                                    finish({
                                        success: false,
                                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                                        error: `Execution error: ${execErr.message}`
                                    });
                                    return;
                                }

                                terminalWindow?.webContents.send('terminal-data', `${code}\n`);

                                stream.on('close', (exitCode, signal) => {
                                    console.log(`Command completed: exit code ${exitCode}, signal ${signal}`);
                                    finish({
                                        success: exitCode === 0,
                                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                                        error: threshold(error, params.max_lines, params.max_chars_per_line)
                                    });
                                });

                                stream.on('data', (data) => {
                                    output += data.toString();
                                    terminalWindow?.webContents.send('terminal-data', data.toString());
                                });

                                stream.stderr.on('data', (data) => {
                                    error += data.toString();
                                    terminalWindow?.webContents.send('terminal-data', data.toString());
                                });

                                // 终端输入处理
                                const inputHandler = (event, input) => {
                                    if (!input) {
                                        stream.end();
                                    } else {
                                        stream.write(input);
                                    }
                                };

                                const signalHandler = (event, signal) => {
                                    if (signal === "ctrl_c") {
                                        stream.close();
                                    }
                                };

                                ipcMain.on('terminal-input', inputHandler);
                                ipcMain.on('terminal-signal', signalHandler);

                                // 清理事件监听器
                                stream.on('close', () => {
                                    ipcMain.removeListener('terminal-input', inputHandler);
                                    ipcMain.removeListener('terminal-signal', signalHandler);
                                });
                            });
                        });
                    });
                });

                conn.on('error', (err) => {
                    console.error('SSH Connection Error:', err);
                    finish({
                        success: false,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: `SSH connection failed: ${err.message}`
                    });
                });

                conn.on('close', () => {
                    console.log('SSH Connection Closed');
                });

                // 建立连接
                try {
                    conn.connect(sshConfig);
                } catch (connectErr) {
                    finish({
                        success: false,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: `SSH connection failed: ${connectErr.message}`
                    });
                }

            } else {
                // 本地执行
                const child = exec(`${params.bash || 'bash'} ${tempFile}`);

                child.on('error', (childErr) => {
                    finish({
                        success: false,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: `Process execution failed: ${childErr.message}`
                    });
                });

                child.stdout.on('data', (data) => {
                    output += data.toString();
                    terminalWindow?.webContents.send('terminal-data', data.toString());
                });

                child.stderr.on('data', (data) => {
                    error += data.toString();
                    terminalWindow?.webContents.send('terminal-data', data.toString());
                });

                child.on('close', (exitCode) => {
                    finish({
                        success: exitCode === 0,
                        output: threshold(output, params.max_lines, params.max_chars_per_line),
                        error: threshold(error, params.max_lines, params.max_chars_per_line)
                    });
                });

                // 终端输入处理
                const inputHandler = (event, input) => {
                    if (!input) {
                        child.stdin.end();
                    } else {
                        child.stdin.write(input);
                    }
                };

                const signalHandler = (event, signal) => {
                    if (signal === "ctrl_c") {
                        child.kill('SIGINT');
                    }
                };

                ipcMain.on('terminal-input', inputHandler);
                ipcMain.on('terminal-signal', signalHandler);

                // 清理事件监听器
                child.on('close', () => {
                    ipcMain.removeListener('terminal-input', inputHandler);
                    ipcMain.removeListener('terminal-signal', signalHandler);
                });
            }
        });
    };
}

function getPrompt() {
    const prompt = `## cli_read
Description: A secure read-only command-line tool for executing safe bash commands in Linux environments. Only allows file and directory reading operations, system information queries, and other non-destructive operations.

Security Features:
- Strict command whitelist (only safe read-only commands allowed)
- Forbidden patterns detection (blocks any modification operations)
- Command injection protection
- Code length and line count limits

Allowed Commands Examples:
- File viewing: cat, head, tail, less, more
- Directory listing: ls, dir, tree
- File searching: find, grep, locate
- System information: ps, top, free, uptime, uname
- File properties: stat, file, wc, du, df
- Text processing: sort, uniq, cut, awk, sed (read-only mode)
- Network information: netstat, ss, ping (information only)

Strictly Forbidden:
- Any file modification: rm, mv, cp, chmod, etc.
- System changes: useradd, service, systemctl, etc.
- Network operations: wget, curl, ssh, etc.
- Command injection: backticks, command substitution
- Privilege escalation: sudo, su, etc.

Parameters:
- code: (Required) Safe bash code snippet containing only read-only operations (please strictly follow the code format, incorrect indentation and line breaks will cause code execution to fail)
- timeout: (Optional) Maximum execution time in seconds (default: At least 3600 seconds). If the command times out, the current console output will be returned with a failure status.

Usage:
{
  "thinking": "[Detailed thought process, including specifics of the reading operations. If the current execution involves file content, please record the absolute file path here in detail. Ensure only safe read-only commands are used. Consider setting an appropriate timeout for long-running commands.]",
  "tool": "cli_read",
  "params": {
    "code": "[Safe read-only code snippet]",
    "timeout": [Optional timeout in seconds]
  }
}`;
    return prompt;
}

module.exports = {
    main, getPrompt
};