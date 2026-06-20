// On the server (Node.js), relative URLs don't work with fetch.
// Use NEXT_PUBLIC_API_URL only on the client; fall back to the internal absolute URL on the server.
const isServer = typeof window === 'undefined';
export const API_BASE_URL = isServer
  ? (process.env.INTERNAL_API_URL || 'http://localhost:5000/api/v1')
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1');

let isRefreshing = false;
let refreshSubscribers: ((success: boolean) => void)[] = [];

function onRefreshed(success: boolean) {
  refreshSubscribers.forEach((callback) => callback(success));
  refreshSubscribers = [];
}

function addRefreshSubscriber(callback: (success: boolean) => void) {
  refreshSubscribers.push(callback);
}

export class HttpClient {

  public async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const { headers, ...restOptions } = options || {};

    const config: RequestInit = {
      ...restOptions,
      // Send the httpOnly auth cookie automatically on every request.
      // The cookie is set by the server on login and is NOT accessible to JavaScript.
      // This replaces the old localStorage token approach.
      credentials: 'include',
      headers: {
        ...headers,
      },
    };

    // Only set Content-Type: application/json when there's an actual JSON body.
    // Do NOT set it for GET/DELETE (no body) or FormData (multipart) requests,
    // as Fastify will reject requests with Content-Type: application/json but no body.
    if (options?.body && !(options.body instanceof FormData)) {
      (config.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined' && endpoint !== '/auth/refresh') {
        if (!isRefreshing) {
          isRefreshing = true;
          try {
            const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
              method: 'POST',
              credentials: 'include',
            });
            
            if (refreshRes.ok) {
              isRefreshing = false;
              onRefreshed(true);
              // Retry original request
              return this.request(endpoint, options);
            } else {
              throw new Error('Refresh failed');
            }
          } catch (e) {
            isRefreshing = false;
            onRefreshed(false);
            import('@/stores/auth-store').then(({ useAuthStore }) => {
              useAuthStore.getState().clearAuth();
              window.location.href = '/login';
            });
            throw new Error('Session expired. Please log in again.');
          }
        } else {
          // Wait for the ongoing refresh to complete
          return new Promise<T>((resolve, reject) => {
            addRefreshSubscriber((success) => {
              if (success) {
                resolve(this.request<T>(endpoint, options));
              } else {
                reject(new Error('Session expired'));
              }
            });
          });
        }
      }

      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData?.error?.message || errorData?.message || JSON.stringify(errorData);
      } catch {
        const textError = await response.text();
        errorMessage = textError || errorMessage;
      }

      throw new Error(errorMessage);
    }

    // Handle empty responses
    if (response.status === 204) return {} as T;
    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
  }

}