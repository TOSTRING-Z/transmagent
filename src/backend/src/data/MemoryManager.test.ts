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

// ── Mock：底层依赖需在 import 之前声明 ──────────────────────────────────────

jest.mock('axios');
jest.mock('./MemoryDB');
jest.mock('../utils/public', () => ({
    getDefault: jest.fn((name: string) => `/tmp/.transmagent/${name ?? ''}`),
    getDefaultConfig: jest.fn(),
}));

// ── 正式 import ──────────────────────────────────────────────────────────────

import axios from 'axios';
import MemoryManager from './MemoryManager';
import { MemoryDB } from './MemoryDB';
import { getDefaultConfig } from '../utils/public';
import { MemoryRecord } from './MemoryDB';

// ── 类型辅助 ─────────────────────────────────────────────────────────────────

const mockedAxios = axios as jest.Mocked<typeof axios>;
const MockedMemoryDB = MemoryDB as jest.MockedClass<typeof MemoryDB>;
const mockedGetDefaultConfig = getDefaultConfig as jest.MockedFunction<typeof getDefaultConfig>;

// ── 测试数据 ──────────────────────────────────────────────────────────────────

const FAKE_EMBEDDING = Array.from({ length: 8 }, (_, i) => i * 0.1);

const MOCK_RECORDS: MemoryRecord[] = [
    { chat_id: 'chat-001', content: '今天天气真不错', time: '2025-01-01 10:00:00', similarity: 0.95 },
    { chat_id: 'chat-002', content: '明天需要开会', time: '2025-01-02 09:00:00', similarity: 0.88 },
];

/** 构造一个启用了 Embedding 的配置对象 */
const buildEmbeddingConfig = () => ({
    enabled: true,
    base_url: 'https://api.example.com/v1',
    api_key: 'sk-test-key',
    model: 'text-embedding-3-small',
});

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('MemoryManager.queryLongTermMemory', () => {
    let manager: MemoryManager;
    let mockQueryFn: jest.MockedFunction<InstanceType<typeof MemoryDB>['query']>;

    beforeEach(() => {
        jest.clearAllMocks();

        // 让 MemoryDB 构造函数静默通过，并 mock 其 init/query 方法
        MockedMemoryDB.prototype.init = jest.fn().mockResolvedValue(undefined);
        mockQueryFn = jest.fn().mockResolvedValue(MOCK_RECORDS);
        MockedMemoryDB.prototype.query = mockQueryFn;

        manager = new MemoryManager();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 场景 1：Embedding 正常，走向量 + BM25 融合路径
    // ─────────────────────────────────────────────────────────────────────────
    describe('Embedding 服务可用', () => {
        beforeEach(() => {
            mockedGetDefaultConfig.mockReturnValue(buildEmbeddingConfig());
            mockedAxios.post = jest.fn().mockResolvedValue({
                data: {
                    data: [{ embedding: FAKE_EMBEDDING }],
                },
            });
        });

        it('应调用 axios 获取 Embedding 向量', async () => {
            await manager.queryLongTermMemory('今天天气如何');

            expect(mockedAxios.post).toHaveBeenCalledTimes(1);
            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('/embeddings'),
                expect.objectContaining({ input: '今天天气如何' }),
                expect.any(Object),
            );
        });

        it('应将 embedding 和 query 传入 memoryDB.query', async () => {
            await manager.queryLongTermMemory('今天天气如何');

            expect(mockQueryFn).toHaveBeenCalledTimes(1);
            expect(mockQueryFn).toHaveBeenCalledWith(
                FAKE_EMBEDDING,
                '今天天气如何',
                5, // 默认 topK
            );
        });

        it('应返回 memoryDB.query 的结果', async () => {
            const result = await manager.queryLongTermMemory('今天天气如何');

            expect(result).toEqual(MOCK_RECORDS);
            expect(result).toHaveLength(2);
        });

        it('自定义 topK 应正确透传', async () => {
            await manager.queryLongTermMemory('会议安排', 3);

            expect(mockQueryFn).toHaveBeenCalledWith(
                FAKE_EMBEDDING,
                '会议安排',
                3,
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 场景 2：Embedding 配置未启用，降级为纯 BM25
    // ─────────────────────────────────────────────────────────────────────────
    describe('Embedding 配置未启用', () => {
        it('当 enabled=false 时，embedding 应为 null，跳过 axios 调用', async () => {
            mockedGetDefaultConfig.mockReturnValue({ enabled: false });

            await manager.queryLongTermMemory('测试查询');

            expect(mockedAxios.post).not.toHaveBeenCalled();
            expect(mockQueryFn).toHaveBeenCalledWith(
                null,
                '测试查询',
                5,
            );
        });

        it('当配置对象为 null 时，embedding 应为 null', async () => {
            mockedGetDefaultConfig.mockReturnValue(null);

            await manager.queryLongTermMemory('测试查询');

            expect(mockedAxios.post).not.toHaveBeenCalled();
            expect(mockQueryFn).toHaveBeenCalledWith(null, '测试查询', 5);
        });

        it('缺少 api_key 时，embedding 应为 null', async () => {
            mockedGetDefaultConfig.mockReturnValue({
                enabled: true,
                base_url: 'https://api.example.com/v1',
                api_key: '',  // 空
            });

            await manager.queryLongTermMemory('测试查询');

            expect(mockedAxios.post).not.toHaveBeenCalled();
            expect(mockQueryFn).toHaveBeenCalledWith(null, '测试查询', 5);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 场景 3：Embedding API 请求失败，降级为 null -> 纯 BM25
    // ─────────────────────────────────────────────────────────────────────────
    describe('Embedding API 请求失败', () => {
        beforeEach(() => {
            mockedGetDefaultConfig.mockReturnValue(buildEmbeddingConfig());
            mockedAxios.post = jest.fn().mockRejectedValue(new Error('Network Error'));
        });

        it('axios 抛出异常时 embedding 应为 null，不抛出错误', async () => {
            await expect(manager.queryLongTermMemory('网络异常测试')).resolves.toBeDefined();
        });

        it('axios 失败后应以 null embedding 调用 memoryDB.query', async () => {
            await manager.queryLongTermMemory('网络异常测试');

            expect(mockQueryFn).toHaveBeenCalledWith(
                null,
                '网络异常测试',
                5,
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 场景 4：默认 topK 参数验证
    // ─────────────────────────────────────────────────────────────────────────
    describe('默认 topK 参数', () => {
        it('不传 topK 时默认应为 5', async () => {
            mockedGetDefaultConfig.mockReturnValue(null);

            await manager.queryLongTermMemory('任意查询');

            expect(mockQueryFn).toHaveBeenCalledWith(null, '任意查询', 5);
        });

        it('topK=1 时应正确传递', async () => {
            mockedGetDefaultConfig.mockReturnValue(null);

            await manager.queryLongTermMemory('任意查询', 1);

            expect(mockQueryFn).toHaveBeenCalledWith(null, '任意查询', 1);
        });
    });
});
