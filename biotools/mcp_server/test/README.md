# 单元测试说明

本目录包含biotools MCP服务器的单元测试。

## 测试文件结构

- `test_search_functions.py`: 搜索函数的单元测试
- `test_integration.py`: 集成测试
- `conftest.py`: pytest配置和fixtures
- `pytest.ini`: pytest配置文件

## 测试覆盖的功能

测试覆盖以下搜索函数：

1. **search_tr**: 搜索串联重复样本
2. **search_h3k27ac**: 搜索H3K27ac超级增强子样本
3. **search_erna**: 搜索eRNA样本
4. **search_atac**: 搜索ATAC-seq样本

## 运行测试

### 安装依赖

首先确保已安装pytest和pytest-asyncio：

```bash
pip install pytest pytest-asyncio
```

### 运行所有测试

```bash
cd /data/zgr/transagent/tmp/transmagent/biotools/mcp_server
pytest test/ -v
```

### 运行特定测试文件

```bash
pytest test/test_search_functions.py -v
pytest test/test_integration.py -v
```

### 运行特定测试类

```bash
pytest test/test_search_functions.py::TestSearchTR -v
pytest test/test_integration.py::TestSearchIntegration -v
```

### 运行特定测试方法

```bash
pytest test/test_search_functions.py::TestSearchTR::test_search_tr_empty_keyword -v
```

## 测试设计原则

### 1. 单元测试 (`test_search_functions.py`)
- 测试单个函数的各种边界情况
- 使用mock隔离外部依赖
- 测试错误处理

### 2. 集成测试 (`test_integration.py`)
- 测试多个函数的协同工作
- 使用fixtures提供测试数据
- 测试实际使用场景

### 3. Fixtures (`conftest.py`)
- 提供可重用的测试数据
- 模拟真实的数据结构
- 支持参数化测试

## 测试数据

测试使用模拟数据，不依赖实际数据库文件。模拟数据包括：

1. **TR数据**: 模拟串联重复样本信息
2. **H3K27ac数据**: 模拟超级增强子样本信息
3. **eRNA数据**: 模拟eRNA样本信息
4. **ATAC-seq数据**: 模拟开放染色质样本信息

## 测试场景

### 成功场景
- 单关键词搜索
- 多条件搜索（使用`+`分隔）
- 大小写不敏感搜索
- 部分匹配搜索

### 错误场景
- 空关键词
- 无匹配结果
- 元数据未加载
- 无效输入

### 边界场景
- 大量匹配结果（限制输出为20条）
- 特殊字符处理
- 数据类型验证

## 添加新测试

### 1. 添加新的测试函数
在现有测试类中添加新的测试方法，遵循命名约定`test_*`

### 2. 添加新的测试类
创建新的测试类，继承自`unittest.TestCase`或使用pytest风格

### 3. 添加新的fixtures
在`conftest.py`中添加新的fixture函数

## 测试覆盖率

当前测试覆盖：
- 所有搜索函数的基本功能
- 错误处理逻辑
- 输出格式验证
- 多条件搜索功能

## 注意事项

1. 测试使用异步函数，需要`pytest-asyncio`插件
2. 测试模拟了全局变量，确保测试隔离
3. 测试不依赖外部文件系统
4. 测试数据与实际数据结构保持一致

## 调试测试

如果测试失败，可以：

1. 使用`-v`参数查看详细输出
2. 使用`--tb=long`查看完整回溯
3. 使用`pytest --pdb`进入调试器
4. 检查模拟数据是否正确

## 持续集成

建议将测试集成到CI/CD流程中，确保代码质量。