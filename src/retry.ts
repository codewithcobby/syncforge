export interface RetryStrategy {
  getDelay(attempt: number): number;
}

export const immediateRetryStrategy: RetryStrategy = {
  getDelay: () => 0,
};
