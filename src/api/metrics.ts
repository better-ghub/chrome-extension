// API Metrics - tracks API calls

interface MetricEntry {
  type: string;
  endpoint: string;
  timestamp: number;
}

export const apiMetrics = {
  calls: { rest: 0, graphql: 0 },
  history: [] as MetricEntry[],

  incrementCall(type: 'rest' | 'graphql', endpoint: string): void {
    this.calls[type]++;
    this.history.push({ type, endpoint, timestamp: Date.now() });
    if (this.history.length > 100) this.history.shift();
  },

  getCount(): number {
    return this.calls.rest + this.calls.graphql;
  },

  reset(): void {
    this.calls = { rest: 0, graphql: 0 };
    this.history = [];
  },
};
