const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// eslint-disable-next-line no-undef
const DIST_DIR = path.join(__dirname, 'dist');

// 控制台颜色
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    blue: "\x1b[34m",
    red: "\x1b[31m",
    yellow: "\x1b[33m"
};

console.log(`${colors.blue}[Build] Starting build process...${colors.reset}`);

// 1. 清理旧目录
if (fs.existsSync(DIST_DIR)) {
    console.log(`${colors.yellow}[Build] Cleaning up old dist directory...${colors.reset}`);
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
}

// 2. 运行 TypeScript 编译
try {
    console.log(`${colors.blue}[Build] Compiling TypeScript...${colors.reset}`);
    
    // 执行 tsc (stdio: 'inherit' 会将 tsc 的输出直接打印到控制台)
    execSync('npx tsc', { stdio: 'inherit' });
    
    console.log(`${colors.green}[Build] ✓ Compilation successful! Output saved to ./dist${colors.reset}`);
} catch {
    console.log(`${colors.red}[Build] ✗ Compilation failed. Please check the TypeScript errors above.${colors.reset}`);
    // eslint-disable-next-line no-undef
    process.exit(1);
}