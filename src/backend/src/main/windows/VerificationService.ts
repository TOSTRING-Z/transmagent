import { Client as SSHClient } from 'ssh2';
import axios from 'axios';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface VerifyResult {
    ok: boolean;
    message: string;
    detail?: string;
    elapsed_ms?: number;
}

/**
 * Unified verification interface for python_execute and image_vision parameters.
 * Each verification returns a structured VerifyResult for UI display.
 */
export class VerificationService {

    // ============================================================
    // 1. File existence verification
    // ============================================================
    public async verifyFile(filePath: string): Promise<VerifyResult> {
        const start = Date.now();
        try {
            if (!filePath || typeof filePath !== 'string') {
                return { ok: false, message: 'No file path provided', elapsed_ms: Date.now() - start };
            }
            if (!fs.existsSync(filePath)) {
                return { ok: false, message: `File not found: ${filePath}`, elapsed_ms: Date.now() - start };
            }
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
                return { ok: false, message: `Path is not a regular file: ${filePath}`, elapsed_ms: Date.now() - start };
            }
            return {
                ok: true,
                message: `File exists (${stat.size} bytes)`,
                detail: filePath,
                elapsed_ms: Date.now() - start
            };
        } catch (err: any) {
            return { ok: false, message: 'File check failed', detail: err.message, elapsed_ms: Date.now() - start };
        }
    }

    // ============================================================
    // 2. SSH connection verification
    // ============================================================
    public async verifySSH(sshConfig: any): Promise<VerifyResult> {
        const start = Date.now();
        return new Promise((resolve) => {
            if (!sshConfig || !sshConfig.host || !sshConfig.username) {
                return resolve({ ok: false, message: 'SSH config incomplete (need host + username)', elapsed_ms: Date.now() - start });
            }
            if (!sshConfig.enabled) {
                return resolve({ ok: false, message: 'SSH is disabled in settings', elapsed_ms: Date.now() - start });
            }
            const conn = new SSHClient();
            const timeout = setTimeout(() => {
                conn.end();
                resolve({ ok: false, message: 'SSH connection timeout (10s)', elapsed_ms: Date.now() - start });
            }, 10000);
            conn.on('ready', () => {
                clearTimeout(timeout);
                conn.end();
                resolve({
                    ok: true,
                    message: `SSH connected to ${sshConfig.username}@${sshConfig.host}:${sshConfig.port || 22}`,
                    elapsed_ms: Date.now() - start
                });
            }).on('error', (err: any) => {
                clearTimeout(timeout);
                resolve({ ok: false, message: 'SSH connection failed', detail: err.message, elapsed_ms: Date.now() - start });
            }).connect({
                host: sshConfig.host,
                port: sshConfig.port || 22,
                username: sshConfig.username,
                password: sshConfig.password,
                readyTimeout: 8000
            });
        });
    }

    // ============================================================
    // 3. MCP connection verification (HTTP probe)
    // ============================================================
    public async verifyMCP(mcpConfig: any): Promise<VerifyResult> {
        const start = Date.now();
        try {
            if (!mcpConfig || !mcpConfig.url) {
                return { ok: false, message: 'MCP server URL not configured', elapsed_ms: Date.now() - start };
            }
            if (mcpConfig.disabled) {
                return { ok: false, message: 'MCP server is disabled', elapsed_ms: Date.now() - start };
            }
            const url = mcpConfig.url.replace(/\/$/, '');
            const response = await axios.get(url, { timeout: 5000, validateStatus: () => true });
            const elapsed = Date.now() - start;
            if (response.status >= 200 && response.status < 500) {
                return {
                    ok: true,
                    message: `MCP server reachable (HTTP ${response.status})`,
                    detail: url,
                    elapsed_ms: elapsed
                };
            }
            return {
                ok: false,
                message: `MCP server returned HTTP ${response.status}`,
                detail: url,
                elapsed_ms: elapsed
            };
        } catch (err: any) {
            return {
                ok: false,
                message: 'MCP connection failed',
                detail: err.code === 'ECONNABORTED' ? 'Timeout (5s)' : err.message,
                elapsed_ms: Date.now() - start
            };
        }
    }

    // ============================================================
    // 4. Python environment verification (python_execute.python_bin)
    //    Unified interface: spawn python_bin, run sanity script, capture exit code
    // ============================================================
    public async verifyPython(pythonBin: string): Promise<VerifyResult> {
        const start = Date.now();
        return new Promise((resolve) => {
            const bin = pythonBin || 'python';
            const probeScript = 'import sys; print(sys.version.split()[0]); print(sys.executable)';
            const child = spawn(bin, ['-c', probeScript], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

            let stdout = '';
            let stderr = '';
            const timeout = setTimeout(() => {
                child.kill('SIGKILL');
                resolve({ ok: false, message: 'Python execution timeout (8s)', detail: `bin: ${bin}`, elapsed_ms: Date.now() - start });
            }, 8000);

            child.stdout?.on('data', (d) => { stdout += d.toString(); });
            child.stderr?.on('data', (d) => { stderr += d.toString(); });

            child.on('error', (err: any) => {
                clearTimeout(timeout);
                resolve({
                    ok: false,
                    message: 'Python binary not found or not executable',
                    detail: `${bin}: ${err.message}`,
                    elapsed_ms: Date.now() - start
                });
            });

            child.on('close', (code) => {
                clearTimeout(timeout);
                const elapsed = Date.now() - start;
                if (code === 0 && stdout.trim()) {
                    const lines = stdout.trim().split('\n');
                    resolve({
                        ok: true,
                        message: `Python ${lines[0]} ready`,
                        detail: lines[1] || bin,
                        elapsed_ms: elapsed
                    });
                } else {
                    resolve({
                        ok: false,
                        message: `Python exited with code ${code}`,
                        detail: stderr.trim() || 'No output',
                        elapsed_ms: elapsed
                    });
                }
            });
        });
    }

    // ============================================================
    // 5. Vision model verification (image_vision Parameters)
    //    Probe the vision API endpoint with a minimal request
    // ============================================================
    public async verifyVision(visionConfig: any): Promise<VerifyResult> {
        const start = Date.now();
        try {
            if (!visionConfig || !visionConfig.base_url || !visionConfig.api_key) {
                return { ok: false, message: 'Vision model not configured (need base_url + api_key)', elapsed_ms: Date.now() - start };
            }
            const url = visionConfig.base_url.replace(/\/$/, '') + '/chat/completions';
            const probePayload = {
                model: visionConfig.model || 'gpt-4o',
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 5
            };
            const response = await axios.post(url, probePayload, {
                headers: { 'Authorization': `Bearer ${visionConfig.api_key}`, 'Content-Type': 'application/json' },
                timeout: 10000,
                validateStatus: () => true
            });
            const elapsed = Date.now() - start;
            if (response.status === 200 && response.data?.choices?.[0]?.message?.content !== undefined) {
                return {
                    ok: true,
                    message: `Vision model ${probePayload.model} responsive`,
                    detail: `Endpoint: ${visionConfig.base_url}`,
                    elapsed_ms: elapsed
                };
            }
            if (response.status === 401 || response.status === 403) {
                return { ok: false, message: 'Vision API authentication failed', detail: `HTTP ${response.status}`, elapsed_ms: elapsed };
            }
            return {
                ok: false,
                message: `Vision API error (HTTP ${response.status})`,
                detail: response.data?.error?.message || JSON.stringify(response.data).slice(0, 200),
                elapsed_ms: elapsed
            };
        } catch (err: any) {
            return {
                ok: false,
                message: 'Vision model unreachable',
                detail: err.code === 'ECONNABORTED' ? 'Timeout (10s)' : err.message,
                elapsed_ms: Date.now() - start
            };
        }
    }
}

export const verificationService = new VerificationService();
