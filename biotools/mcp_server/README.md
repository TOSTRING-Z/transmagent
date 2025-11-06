# docker Environment

[docker](https://www.anaconda.com/docs/tools/working-with-conda/applications/docker#docker)
[mcp-fetch](https://github.com/modelcontextprotocol/servers/blob/main/src/fetch/Dockerfile)

```bash
# Build (using Clash proxy)
* linux
docker build \
  --add-host=host.docker.internal:host-gateway \
  --build-arg HTTP_PROXY=http://host.docker.internal:7890 \
  --build-arg HTTPS_PROXY=http://host.docker.internal:7890 \
  -t biotools:latest .

* windows
docker build `
  --add-host=host.docker.internal:host-gateway `
  --build-arg HTTP_PROXY=http://host.docker.internal:7890 `
  --build-arg HTTPS_PROXY=http://host.docker.internal:7890 `
  -t biotools:latest .

# Build (without proxy)
docker build -t biotools:latest .

# Save image
docker save -o biotools.tar biotools:latest

# Load image
docker load -i biotools.tar
```

## TransAgent Visual Terminal Startup

### Download basic environment data

- [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.15291175.svg)](https://doi.org/10.5281/zenodo.15291175)
- [Baidu Netdisk](https://pan.baidu.com/s/1YSH2Y-n_1N4YY1Rk-L7KLA?pwd=khzx)
### Download Data Section (Excluding Tools; Automatically Managed by the Agent)

> Users may choose to download only this data section, which has a smaller memory footprint.
> The Conda environment and analytical tools can be automatically installed and managed by the TransAgent intelligent agent during runtime.

- [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.17523239.svg)](https://doi.org/10.5281/zenodo.17523239)
- [Baidu Netdisk](https://pan.baidu.com/s/1HRCcue-ql5hftPpX4INfWA?pwd=4rfq)

### Data decompression
```bash
tar -xzvf data.tar.gz -C data
tar -xzvf conda.tar.gz -C data/conda
```

### Start docker container

```bash
# linux
docker run -it --name biotools_admin \
--add-host=host.docker.internal:host-gateway \
--env http_proxy=http://host.docker.internal:7890 \
--env https_proxy=http://host.docker.internal:7890 \
-p 3001:3001 \
-p 3002:22 \
-v /data/zgr/transagent/biotools/tmp:/tmp \
-v /data/zgr/transagent/biotools/data:/data \
-v /data/zgr/transagent/biotools/mcp_server/server.py:/app/server.py \
-v /data/zgr/transagent/biotools/mcp_server/cli_prompt.md:/app/cli_prompt.md \
biotools

# linux (only read)
docker run -it --name biotools \
-p 3001:3001 \
-p 3002:22 \
-v /data/zgr/transagent/biotools/tmp:/tmp \
-v /data/zgr/transagent/biotools/data:/data:ro \
-v /data/zgr/transagent/biotools/mcp_server/server.py:/app/server.py:ro \
-v /data/zgr/transagent/biotools/mcp_server/cli_prompt.md:/app/cli_prompt.md:ro \
biotools

# window (only read)
docker run -it --name biotools `
-p 3001:3001 `
-p 3002:22 `
-v C:/Users/Administrator/Desktop/Document/transagent/biotools/tmp:/tmp `
-v C:/Users/Administrator/Desktop/Document/transagent/biotools/data:/data:ro `
-v C:/Users/Administrator/Desktop/Document/transagent/biotools/mcp_server/server.py:/app/server.py:ro `
-v C:/Users/Administrator/Desktop/Document/transagent/biotools/mcp_server/cli_prompt.md:/app/cli_prompt.md:ro `
biotools
```

### Visual terminal configuration

config.json

```json
"plugins": {
  "cli_execute": {
    "params": {
      "bashrc": "/root/.bashrc",
      "show": true,
      "delay_time": 5,
      "timeout": 3600,
      "max_lines": 40,
      "max_chars_per_line": 200
    },
    "enabled": true
  },
  "display_file": {
    "params": {
      "local_path": null
    },
    "enabled": true
  }
},
"mcp_server": {
  "biotools": {
    "url": "http://0.0.0.0:3001/biotools",
    "disabled": false
  }
}
```

### System information configuration

```bash
# View system information
echo -n '{
  "system_type": "linux",
  "system_platform": "'$( (lsb_release -si 2>/dev/null || grep -E '^ID=' /etc/os-release | cut -d= -f2) | tr '[:upper:]' '[:lower:]')$((lsb_release -sr 2>/dev/null || grep -E '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"') | cut -d. -f1)'",
  "system_arch": "'$(uname -m | sed 's/aarch64/arm64/;s/x86_64/amd64/')'"
}' | jq -c . 2>/dev/null || cat
```

config.json

```json
"tool_call": {
  "memory_length": 40,
  "long_memory_length": 100,
  "mcp_timeout": 60,
  "extra_prompt": null,
  "cli_prompt": null,
  "subagent": true,
  "subagent_llm_init": false,
  "env_message": true,
  "max_thinking_repetitions": 3,
  "repetitions_delay_empty": 2,
  "tmpdir": "/tmp",
  "language": "english",
  "system_type": "linux",
  "system_platform": "debian12",
  "system_arch": "x86_64",
  "ssh_config": {
    "host": "127.0.0.1",
    "port": 3002,
    "username": "root",
    "password": "password",
    "enabled": true
  },
  "llm_params": {
    "stream": true,
    "response_format": {
      "type": "json_object"
    }
  }
}
```
* tmpdir: Path to save running results (should match docker mapping path)
* language: Language used for LLM responses

# Test
```bash
docker exec -it biotools bash -i -c 'bedtools --help'
```

### MCP service configuration

config.json

```json
"mcp_server": {
  "biotools": {
    "url": "http://172.27.0.3:3001/biotools",
    "disabled": false
  }
}
```

# MCP environment

[python-sdk](https://github.com/modelcontextprotocol/python-sdk)

```bash
# Installation
~/.local/bin/uv add "mcp[cli]"

# Environment

* linux
source mcp_server/.venv/bin/activate

* window
.\mcp_server\.venv\Scripts\activate

# Test
mcp dev mcp_server/server.py
```

# dev

```bash
npx @modelcontextprotocol/inspector
```
