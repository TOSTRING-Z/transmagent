const fs = require('fs');
const os = require('os');
const path = require('path');

const copyFile = (sourcePath, targetPath) => {
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`copy ${sourcePath} -> ${targetPath}`);
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
        } else {
            copyFile(sourceItemPath, targetItemPath);
        }
    }
    console.log(`copy directory ${sourcePath} -> ${targetPath}`);
};

const copyConfig = (name) => {
    // eslint-disable-next-line no-undef
    const sourcePath = path.join(__dirname, '..', name);
    const targetPath = path.join(os.homedir(), '.transmagent', name);

    if (!fs.existsSync(path.dirname(targetPath))) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    }

    const sourceStat = fs.statSync(sourcePath);
    
    if (sourceStat.isDirectory()) {
        copyDirectory(sourcePath, targetPath);
    } else {
        copyFile(sourcePath, targetPath);
    }
};

const isFirstInstall = (name) => {
    const targetPath = path.join(os.homedir(), '.transmagent', name);
    return !fs.existsSync(targetPath);
};

function install(isDefault=false) {
    const configs = [
        "config.json",
        "config_baseagent.json", 
        "config_multagent.json",
        "cli_prompt.md",
        "system_prompts"  // This can be either file or directory
    ];

    for (const config of configs) {
        if (isFirstInstall(config) || isDefault) {
            copyConfig(config);
        }
    }
}

module.exports = {
    install
};