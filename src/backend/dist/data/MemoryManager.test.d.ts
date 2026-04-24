/**
 * MemoryManager.queryLongTermMemory 单元测试
 *
 * 覆盖场景：
 * 1. Embedding 服务可用时，走向量检索 + BM25 RRF 融合路径
 * 2. Embedding 配置未启用时，返回 null，降级为纯 BM25 路径
 * 3. Embedding API 请求失败时，降级为纯 BM25 路径
 * 4. 自定义 topK 参数正确透传
 * 5. 默认 topK = 5
 */
export {};
