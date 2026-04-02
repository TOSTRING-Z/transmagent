"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.install = install;
const fs = __importStar(require("fs"));
const logger_1 = require("../utils/logger");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const copyFile = (sourcePath, targetPath) => {
    fs.copyFileSync(sourcePath, targetPath);
    logger_1.logger.log(`[Install] Copied file: ${sourcePath} -> ${targetPath}`);
};
const copyDirectory = (sourcePath, targetPath) => {
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
        }
        else {
            copyFile(sourceItemPath, targetItemPath);
        }
    }
    logger_1.logger.log(`[Install] Copied directory: ${sourcePath} -> ${targetPath}`);
};
const copyConfig = (name) => {
    // 兼容 TS 编译后的目录结构 (从 dist/core/ 退两层回到项目根目录)
    // 如果打包后资源路径变了（如 asar），请配合 process.resourcesPath 使用
    const sourcePath = path.join(__dirname, '..', '..', name);
    const targetPath = path.join(os.homedir(), '.transmagent', name);
    if (!fs.existsSync(path.dirname(targetPath))) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    }
    if (!fs.existsSync(sourcePath)) {
        logger_1.logger.warn(`[Install Warning] Source file/directory does not exist: ${sourcePath}`);
        return;
    }
    const sourceStat = fs.statSync(sourcePath);
    if (sourceStat.isDirectory()) {
        copyDirectory(sourcePath, targetPath);
    }
    else {
        copyFile(sourcePath, targetPath);
    }
};
const isFirstInstall = (name) => {
    const targetPath = path.join(os.homedir(), '.transmagent', name);
    return !fs.existsSync(targetPath);
};
function install(isDefault = false) {
    const configs = [
        "configs",
        "prompts" // 可以是文件或目录
    ];
    logger_1.logger.log("[Install] Checking installation environment...");
    for (const config of configs) {
        if (isFirstInstall(config) || isDefault) {
            copyConfig(config);
        }
    }
    logger_1.logger.log("[Install] Check complete.");
}
//# sourceMappingURL=Install.js.map