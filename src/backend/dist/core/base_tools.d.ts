export declare function resetRetryCounter(): void;
export declare function getRetryState(): {
    maxRetries: {
        maxRetries: number;
        maxTotalRetries: number;
        backoffMultiplier: number;
        circuitBreakerThreshold: number;
    };
    sessionTotal: number;
    consecutiveFailures: number;
};
export declare function shouldCircuitBreak(): boolean;
export default function getBaseTools(): Record<string, any>;
