import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const copyFile = (sourcePath: string, targetPath: string): void => {
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`[Install] Copied file: ${sourcePath} -> ${targetPath}`);
};

const copyDirectory = (sourcePath: string, targetPath: string): void => {
    if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
    }

    const items = fs.readdirSync(sourcePath);
    
    for (const item of items) {
        const sourceItemPath = path.join(sourcePath, item);
        const targetItemPath = path.join(targetPath, item);
        
        const stat = fs.statSync(sourceItemPath);
        
        if (stat.isDirectory()) {
            copyDirectory(sourceItemPath, targetItemPath);
        } else {
            copyFile(sourceItemPath, targetItemPath);
        }
    }
    console.log(`[Install] Copied directory: ${sourcePath} -> ${targetPath}`);
};

const copyConfig = (name: string): void => {
    // 兼容 TS 编译后的目录结构 (从 dist/core/ 退两层回到项目根目录)
    // 如果打包后资源路径变了（如 asar），请配合 process.resourcesPath 使用
    const sourcePath = path.join(__dirname, '..', '..', name);
    const targetPath = path.join(os.homedir(), '.transmagent', name);

    if (!fs.existsSync(path.dirname(targetPath))) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    }

    if (!fs.existsSync(sourcePath)) {
        console.warn(`[Install Warning] Source file/directory does not exist: ${sourcePath}`);
        return;
    }

    const sourceStat = fs.statSync(sourcePath);
    
    if (sourceStat.isDirectory()) {
        copyDirectory(sourcePath, targetPath);
    } else {
        copyFile(sourcePath, targetPath);
    }
};

const isFirstInstall = (name: string): boolean => {
    const targetPath = path.join(os.homedir(), '.transmagent', name);
    return !fs.existsSync(targetPath);
};

export function install(isDefault: boolean = false): void {
    const configs: string[] = [
        "configs",
        "prompts"  // 可以是文件或目录
    ];

    console.log("[Install] Checking installation environment...");
    for (const config of configs) {
        if (isFirstInstall(config) || isDefault) {
            copyConfig(config);
        }
    }
    console.log("[Install] Check complete.");
}