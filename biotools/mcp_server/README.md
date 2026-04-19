# Docker Environment Building and MCP Environment Startup Guide

## Docker Environment Building
[docker](https://www.anaconda.com/docs/tools/working-with-conda/applications/docker#docker)
[mcp-fetch](https://github.com/modelcontextprotocol/servers/blob/main/src/fetch/Dockerfile)

```bash
# Build with Clash Proxy (Building takes approximately 1 hour; downloading the pre-built image is recommended)
* linux
export https_proxy="http://127.0.0.1:7890"
export http_proxy="http://127.0.0.1:7890"

docker build \
  --add-host=host.docker.internal:host-gateway \
  --build-arg HTTP_PROXY=http://host.docker.internal:7890 \
  --build-arg HTTPS_PROXY=http://host.docker.internal:7890 \
  -t biotools:latest .

* windows
$env:https_proxy = "http://127.0.0.1:7890"
$env:http_proxy = "http://127.0.0.1:7890"

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

## Download Pre-built Docker Image

### Download basic environment data

- [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.15291175.svg)](https://doi.org/10.5281/zenodo.15291175)
- [Baidu Netdisk](https://pan.baidu.com/s/1YSH2Y-n_1N4YY1Rk-L7KLA?pwd=khzx)

### Download Data Section (Excluding Tools; Automatically Managed by the Agent)

> Users may choose to download only this data section, which has a smaller memory footprint.
> The Conda environment and analytical tools can be automatically installed and managed by the TransMAgent intelligent agent during runtime.

- [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.17523239.svg)](https://doi.org/10.5281/zenodo.17523239)
- [Baidu Netdisk](https://pan.baidu.com/s/1HRCcue-ql5hftPpX4INfWA?pwd=4rfq)

### Data decompression

```bash
tar -xzvf data.tar.gz -C data
tar -xzvf conda.tar.gz -C data/conda
```

## MCP Environment Startup

### Start docker container

```bash
# linux
docker run -it --name biotools_admin \
--add-host=host.docker.internal:host-gateway \
--env http_proxy=http://host.docker.internal:7890 \
--env https_proxy=http://host.docker.internal:7890 \
-p 3001:3001 \
-p 3002:22 \
-v /[your_path]/biotools/tmp:/tmp \
-v /[your_path]/biotools/data:/data \
-v /[your_path]/biotools/mcp_server/server.py:/app/server.py \
-v /[your_path]/biotools/mcp_server/cli_prompt.md:/app/cli_prompt.md \
biotools

# linux (only read)
docker run -it --name biotools \
-p 3001:3001 \
-p 3002:22 \
-v /[your_path]/biotools/tmp:/tmp \
-v /[your_path]/biotools/data:/data:ro \
-v /[your_path]/biotools/mcp_server/server.py:/app/server.py:ro \
-v /[your_path]/biotools/mcp_server/cli_prompt.md:/app/cli_prompt.md:ro \
biotools

# window
docker run -it --name biotools `
-p 3001:3001 `
-p 3002:22 `
-v C:/[your_path]/biotools/tmp:/tmp `
-v C:/[your_path]/biotools/data:/data `
-v C:/[your_path]/biotools/mcp_server/server.py:/app/server.py `
-v C:/[your_path]/biotools/mcp_server/cli_prompt.md:/app/cli_prompt.md `
biotools

# window (only read)
docker run -it --name biotools `
-p 3001:3001 `
-p 3002:22 `
-v C:/[your_path]/biotools/tmp:/tmp `
-v C:/[your_path]/biotools/data:/data:ro `
-v C:/[your_path]/biotools/mcp_server/server.py:/app/server.py:ro `
-v C:/[your_path]/biotools/mcp_server/cli_prompt.md:/app/cli_prompt.md:ro `
biotools
```

# Test
```bash
docker exec -it biotools bash -i -c 'bedtools --help'
# or
docker exec -it biotools_admin bash -i -c 'bedtools --help'
```

# Develop and debug with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```
