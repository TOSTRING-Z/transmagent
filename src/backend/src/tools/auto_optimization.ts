import { logger } from '../utils/logger';

// 测试FastAPI应用的/predict端点
async function predict(query, passage, retry_time, url) {
    const data = {
        query,
        passage
    };

    try {
        // 添加重试机制
        const maxRetries = retry_time;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data),
                    });
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const responseData = await response.json();
                logger.log(`query: ${query.slice(0, 20)}..., passage: ${passage.slice(0, 20)}..., response: ${JSON.stringify(responseData)}`);
                return responseData.prediction;
            } catch (error: any) {
                logger.log(`尝试 ${attempt + 1}/${maxRetries} 失败: ${(error as Error).message}`);
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒后重试
                } else {
                    throw error;
                }
            }
        }
    } catch (error: any) {
        logger.log("失败:", (error as Error).message);
    }
}

function main(params) {
    return async ({ query, history }) => {
        const retry_time = params?.retry_time || 3;
        const url = params?.url || "http://127.0.0.1:3004/predict";
        const result = await predict(query, history, retry_time, url);
        return result;
    }
}

export {
    main
};
