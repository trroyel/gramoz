// On the server (Node.js), relative URLs don't work with fetch.
// Use NEXT_PUBLIC_API_URL only on the client; fall back to the internal absolute URL on the server.
const isServer = typeof window === 'undefined';
export const API_BASE_URL = isServer
  ? (process.env.INTERNAL_API_URL || 'http://localhost:5000/api/v1')
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1');

export class HttpClient {
  // ── Refresh-lock state ─────────────────────────────────────────────────────
  // IMPORTANT: These MUST be instance variables, NOT module-level globals.
  //
  // In Next.js SSR, modules are shared across all concurrent requests in the
  // same Node.js process. Module-level `isRefreshing` would be shared between
  // different users' requests — User A's refresh could prevent User B's 401
  // from triggering its own refresh, or subscriber callbacks could fire in the
  // wrong request context (cross-user state leak).
  //
  // Instance variables are safe because each import creates its own HttpClient.
  private isRefreshing = false;
  private refreshSubscribers: ((success: boolean) => void)[] = [];

  private onRefreshed(success: boolean) {
    this.refreshSubscribers.forEach((cb) => cb(success));
    this.refreshSubscribers = [];
  }

  private addRefreshSubscriber(callback: (success: boolean) => void) {
    this.refreshSubscribers.push(callback);
  }

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
        // FormData bodies are one-time-read streams — they cannot be replayed after
        // the first fetch() has consumed them. Don't attempt a retry; instead surface
        // a clear error so the user knows to re-submit the form.
        const isStreamBody = options?.body instanceof FormData;

        if (!this.isRefreshing) {
          this.isRefreshing = true;
          try {
            const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
              method: 'POST',
              credentials: 'include',
            });

            if (refreshRes.ok) {
              this.isRefreshing = false;
              this.onRefreshed(true);
              // Only replay if the body can be safely re-read (JSON string, no body, etc.)
              if (isStreamBody) {
                throw new Error('Session refreshed. Please try again.');
              }
              return this.request(endpoint, options);
            } else {
              throw new Error('Refresh failed');
            }
          } catch (e: any) {
            this.isRefreshing = false;
            this.onRefreshed(false);
            // Only redirect on actual auth failure, not on stream-body errors
            if (!isStreamBody || e?.message === 'Refresh failed') {
              import('@/stores/auth-store').then(({ useAuthStore }) => {
                useAuthStore.getState().clearAuth();
                window.location.href = '/login';
              });
            }
            throw new Error(e?.message === 'Session refreshed. Please try again.'
              ? e.message
              : 'Session expired. Please log in again.');
          }
        } else {
          // Wait for the ongoing refresh to complete
          return new Promise<T>((resolve, reject) => {
            this.addRefreshSubscriber((success) => {
              if (success) {
                if (isStreamBody) {
                  reject(new Error('Session refreshed. Please try again.'));
                } else {
                  resolve(this.request<T>(endpoint, options));
                }
              } else {
                reject(new Error('Session expired'));
              }
            });
          });
        }
      }


      let errorMessage = `HTTP ${response.status}`;
      try {
        // A Response body is a one-time-read stream — calling response.json()
        // and then response.text() in the catch will always throw
        // "body stream already read". Read as text once, then parse.
        const rawText = await response.text();
        if (rawText) {
          try {
            const errorData = JSON.parse(rawText);
            errorMessage = errorData?.error?.message || errorData?.message || JSON.stringify(errorData);
          } catch {
            errorMessage = rawText;
          }
        }
      } catch {
        // Network-level error reading the body — keep the default HTTP status message
      }

      throw new Error(errorMessage);
    }

    // Handle empty responses
    if (response.status === 204) return {} as T;
    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
  }

}