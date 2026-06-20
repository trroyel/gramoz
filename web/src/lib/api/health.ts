import { HttpClient } from '../http-clients';

export interface HealthReport {
  status: 'ok' | 'error' | 'shutting_down';
  info?: Record<string, { status: string; [key: string]: any }>;
  error?: Record<string, { status: string; [key: string]: any }>;
  details?: Record<string, { status: string; [key: string]: any }>;
}

class HealthApi extends HttpClient {
  async getHealth(): Promise<HealthReport> {
    // Note: The health endpoint might return 503 if any service is down,
    // which our HttpClient intercepts and throws. We might need to handle
    // this gracefully if the API is up but some dependencies are down.
    // For now, we will just fetch it directly. If it fails, our error handler catches it.
    // But since the health check returns valid JSON on 503, let's catch and parse it manually if needed.
    // However, our `HttpClient` currently throws an Error on `!response.ok`.
    // So we'll add a custom fetch here to avoid throwing on 503 since 503 is a valid health response.
    const isServer = typeof window === 'undefined';
    const API_BASE_URL = isServer
      ? (process.env.INTERNAL_API_URL || 'http://localhost:5000/api/v1')
      : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1');

    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
    });

    if (!response.ok && response.status !== 503) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    return json.success && json.data ? json.data : json;
  }
}

export const healthApi = new HealthApi();
