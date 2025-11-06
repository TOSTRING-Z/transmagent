/* 全局变量 */
const { Utils } = require('./Utils');
const fs = require('fs');
const path = require('path');
const os = require('os');

function createStore() {
  const configPath = path.join(os.homedir(), '.transmagent', 'story.json');
  
  // 确保配置目录和文件存在
  const ensureConfigFile = () => {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, '{}');
    }
  };

  ensureConfigFile();

  return {
    set: (name, value) => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config[name] = value;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
    
    get: (name, defaultValue = undefined) => {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const value = config[name];
      
      if (value === undefined && defaultValue !== undefined) {
        return defaultValue;
      }
      
      return value;
    }
  };
}

const store = createStore();

// 插件配置参数
const inner = {
    url_base: {
        data: {
            collection: '/collection'
        }
    },
    model_name: {
        plugins: "plugins"
    },
    model: {
        plugins: { versions: [] }
    }
};

const config = {
    transagent: "config.json",
    baseagent: "config_baseagent.json",
    multagent: "config_multagent.json",
}

const utils = new Utils(inner, store.get('config', config.transagent));

const global = {
    config: store.get('config', config.transagent),
    model: utils.getConfig("default")["model"],
    version: utils.getConfig("default")["version"],
    is_plugin: this.model === "plugins",
    last_clipboard_content: null,
    concat: false,
    status: {
        auto_opt: false
    }
}


module.exports = {
    store, global, inner, utils, config
};