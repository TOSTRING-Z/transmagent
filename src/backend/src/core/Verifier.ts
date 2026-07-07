import { Client } from 'ssh2';
import axios from 'axios';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

/**
 * Unified verification interface for Agent Configuration quick checks.
 * All handlers return: { success: boolean, message: string, detail?: any }
 */
export interface VerifyResult {
    success: boolean;
    message: string;
    detail?: any;
}

export class Verifier {
    /**
     * 1. File existence validation
     * Validates extra_prompt and cli_prompt paths from tool_call config.
     * Skips empty/null paths silently (treated as success).
     * Returns aggregate result over both files.
     */
    public static async verifyPromptFiles(toolCallConfig: any): Promise<VerifyResult> {
        if (!toolCallConfig) {
            return { success: true, message: 'No tool_call config; file check skipped', detail: { checked: [] } };
        }

        const candidates: Array<{ label: string; path: string }> = [
            { label: 'extra_prompt', path: toolCallConfig.extra_prompt },
            { label: 'cli_prompt', path: toolCallConfig.cli_prompt }
        ];

        const results: Array<{ label: string; path: string; ok: boolean; message: string }> = [];
        let allOk = true;

        for (const c of candidates) {
            // Skip empty / null / undefined paths silently
            if (c.path === undefined || c.path === null || c.path === '') {
                results.push({ label: c.label, path: String(c.path ?? ''), ok: true, message: 'skipped (empty)' });
                continue;
            }
            try {
                const stats = await fs.stat(c.path);
                if (!stats.isFile()) {
                    allOk = false;
                    results.push({ label: c.label, path: c.path, ok: false, message: 'path exists but is not a file' });
                } else {
                    const sizeKB = (stats.size / 1024).toFixed(2);
                    results.push({ label: c.label, path: c.path, ok: true, message: `exists (${sizeKB} KB)` });
                }
            } catch (err: any) {
                allOk = false;
                if (err.code === 'ENOENT') {
                    results.push({ label: c.label, path: c.path, ok: false, message: 'file not found' });
                } else {
                    results.push({ label: c.label, path: c.path, ok: false, message: `error: ${err.message}` });
                }
            }
        }

        const skipped = results.filter(r => r.message === 'skipped (empty)').length;
        const checked = results.filter(r => r.message !== 'skipped (empty)');
        const summary = checked.length === 0
            ? `No prompt files configured (${skipped} skipped)`
            : `Checked ${checked.length} file(s)${skipped ? `, ${skipped} skipped` : ''}: ${allOk ? 'all OK' : 'FAILED'}`;

        return {
            success: allOk,
            message: summary,
            detail: { results, skipped }
        };
    }

    /**
     * 2. SSH connection validation
     */
    public static async verifySsh(sshConfig: any): Promise<VerifyResult> {
        return new Promise((resolve) => {
            if (!sshConfig || !sshConfig.host) {
                return resolve({ success: false, message: 'SSH host not configured' });
            }
            if (!sshConfig.enabled) {
                return resolve({ success: false, message: 'SSH is disabled in settings' });
            }

            const timeout = setTimeout(() => {
                conn.end();
                resolve({ success: false, message: `SSH connection timeout (${sshConfig.host}:${sshConfig.port || 22})` });
            }, 15000);

            const conn = new Client();
            conn.on('ready', () => {
                clearTimeout(timeout);
                conn.end();
                resolve({
                    success: true,
                    message: `SSH connected: ${sshConfig.username}@${sshConfig.host}:${sshConfig.port || 22}`
                });
            });
            conn.on('error', (err: any) => {
                clearTimeout(timeout);
                resolve({ success: false, message: `SSH error: ${err.message}` });
            });
            try {
                conn.connect({
                    host: sshConfig.host,
                    port: sshConfig.port || 22,
                    username: sshConfig.username,
                    password: sshConfig.password,
                    readyTimeout: 10000
                });
            } catch (err: any) {
                clearTimeout(timeout);
                resolve({ success: false, message: `SSH connect failed: ${err.message}` });
            }
        });
    }

    /**
     * 3. MCP server connection validation
     */
    public static async verifyMcp(mcpConfig: any): Promise<VerifyResult> {
        try {
            if (!mcpConfig) {
                return { success: false, message: 'MCP config is empty' };
            }
            // Check BioTools (the project's primary MCP service)
            const biotools = mcpConfig.biotools;
            if (!biotools) {
                return { success: false, message: 'MCP BioTools not configured' };
            }
            if (biotools.disabled) {
                return { success: false, message: 'MCP BioTools is disabled' };
            }
            const url = biotools.url;
            if (!url) {
                return { success: false, message: 'MCP BioTools URL not set' };
            }

            const response = await axios.get(url, { timeout: 10000 });
            return {
                success: true,
                message: `MCP BioTools reachable: ${url} (status ${response.status})`,
                detail: { status: response.status, statusText: response.statusText }
            };
        } catch (err: any) {
            if (err.code === 'ECONNREFUSED') {
                return { success: false, message: `MCP connection refused: ${err.config?.url || 'unknown URL'}` };
            }
            if (err.code === 'ENOTFOUND') {
                return { success: false, message: `MCP host not found: ${err.config?.url || 'unknown URL'}` };
            }
            return { success: false, message: `MCP error: ${err.message}` };
        }
    }

    /**
     * 4. Python environment validation
     * Verifies python_execute tool's python_bin parameter is usable
     */
    public static verifyPython(pythonConfig: string | { python_bin?: string } | undefined | null): Promise<VerifyResult> {
        return new Promise((resolve) => {
            const cmd = typeof pythonConfig === 'string'
                ? pythonConfig || 'python'
                : pythonConfig?.python_bin || 'python';
            const proc = spawn(cmd, ['--version'], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

            let stdout = '';
            let stderr = '';

            const timeout = setTimeout(() => {
                proc.kill('SIGKILL');
                resolve({ success: false, message: `Python check timeout: ${cmd}` });
            }, 8000);

            proc.stdout.on('data', (data: any) => { stdout += data.toString(); });
            proc.stderr.on('data', (data: any) => { stderr += data.toString(); });
            proc.on('error', (err: any) => {
                clearTimeout(timeout);
                if (err.code === 'ENOENT') {
                    resolve({ success: false, message: `Python binary not found: ${cmd}` });
                } else {
                    resolve({ success: false, message: `Python error: ${err.message}` });
                }
            });
            proc.on('close', (code: number | null) => {
                clearTimeout(timeout);
                const output = (stdout + stderr).trim();
                if (code === 0) {
                    resolve({
                        success: true,
                        message: `Python OK: ${cmd} → ${output}`,
                        detail: { binary: cmd, version: output }
                    });
                } else {
                    resolve({
                        success: false,
                        message: `Python exited with code ${code}: ${output || '(no output)'}`
                    });
                }
            });
        });
    }

    /**
     * 5. Image vision validation
     * Verifies the vision model endpoint is reachable and auth works
     */
    public static async verifyVision(visionConfig: any): Promise<VerifyResult> {
        try {
            if (!visionConfig) {
                return { success: false, message: 'Vision config is empty' };
            }

            const params = visionConfig?.plugins?.image_vision?.params || visionConfig;
            const { api_url, api_key, model } = params || {};

            if (!api_url) {
                return { success: false, message: 'Vision api_url not configured' };
            }
            if (!api_key) {
                return { success: false, message: 'Vision api_key not configured' };
            }

            // Send a minimal request to verify connectivity and auth.
            // Most OpenAI-compatible APIs support /models endpoint or a tiny chat completion.
            const response = await axios.post(api_url, {
                model: model || 'gpt-4.1-mini',
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1
            }, {
                headers: { 'Authorization': `Bearer ${api_key}` },
                timeout: 15000,
                validateStatus: () => true  // Don't throw on any status
            });

            if (response.status === 200) {
                return {
                    success: true,
                    message: `Vision API OK: ${model || 'default model'} at ${api_url}`
                };
            }
            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    message: `Vision API auth failed (${response.status}): ${response.data?.error?.message || 'invalid api_key'}`
                };
            }
            return {
                success: false,
                message: `Vision API returned ${response.status}: ${JSON.stringify(response.data?.error || response.data).slice(0, 200)}`
            };
        } catch (err: any) {
            const apiUrl = visionConfig?.plugins?.image_vision?.params?.api_url || visionConfig?.api_url;
            if (err.code === 'ECONNREFUSED') {
                return { success: false, message: `Vision API connection refused: ${apiUrl}` };
            }
            if (err.code === 'ENOTFOUND') {
                return { success: false, message: `Vision API host not found: ${apiUrl}` };
            }
            return { success: false, message: `Vision error: ${err.message}` };
        }
    }

    /**
     * Run all verifications in sequence
     */
    public static async verifyAll(params: {
        toolCallConfig?: any;
        sshConfig?: any;
        mcpConfig?: any;
        pythonConfig?: { python_bin?: string } | string;
        visionConfig?: any;
    }): Promise<Record<string, VerifyResult>> {
        const results: Record<string, VerifyResult> = {};

        // File check (auto from tool_call.extra_prompt + tool_call.cli_prompt)
        results.file = await this.verifyPromptFiles(params.toolCallConfig);

        // SSH check (parallel)
        const sshPromise = params.sshConfig ? this.verifySsh(params.sshConfig) : Promise.resolve(null);
        const mcpPromise = params.mcpConfig ? this.verifyMcp(params.mcpConfig) : Promise.resolve(null);
        const pyPromise = this.verifyPython(params.pythonConfig);
        const visionPromise = params.visionConfig ? this.verifyVision(params.visionConfig) : Promise.resolve(null);

        const [ssh, mcp, py, vision] = await Promise.all([sshPromise, mcpPromise, pyPromise, visionPromise]);
        if (ssh) results.ssh = ssh;
        if (mcp) results.mcp = mcp;
        if (py) results.python = py;
        if (vision) results.vision = vision;

        return results;
    }
}
