#!/bin/bash
# 运行biotools MCP服务器测试的脚本

set -e  # 遇到错误时退出

echo "=== 开始运行biotools MCP服务器测试 ==="
echo "当前目录: $(pwd)"
echo ""

# 检查是否在正确的目录
if [ ! -f "../server.py" ]; then
    echo "错误: 请在mcp_server目录下运行此脚本"
    echo "当前目录: $(pwd)"
    exit 1
fi

# 检查pytest是否安装
if ! command -v pytest &> /dev/null; then
    echo "错误: pytest未安装"
    echo "请运行: pip install pytest pytest-asyncio"
    exit 1
fi

# 运行测试
echo "1. 运行单元测试..."
pytest test_search_functions.py -v --tb=short

echo ""
echo "2. 运行集成测试..."
pytest test_integration.py -v --tb=short

echo ""
echo "3. 运行所有测试..."
pytest . -v --tb=short

echo ""
echo "=== 测试完成 ==="
echo "所有测试已成功运行"