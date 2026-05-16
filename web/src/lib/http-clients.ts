// On the server (Node.js), relative URLs don't work with fetch.
// Use NEXT_PUBLIC_API_URL only on the client; fall back to the internal absolute URL on the server.
const isServer = typeof window === 'undefined';
export const API_BASE_URL = isServer
  ? (process.env.INTERNAL_API_URL || 'http://localhost:5000/api/v1')
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1');

export class HttpClient {

    public async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
        const url = `${API_BASE_URL}${endpoint}`;
        const { headers, ...restOptions } = options || {};

        const config: RequestInit = {
            ...restOptions,
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

        // Safe SSR check for localStorage
        if (typeof window !== 'undefined') {
            const token = localStorage.getItem('auth-token');
            if (token) {
                config.headers = {
                    ...config.headers,
                    'Authorization': `Bearer ${token}`,
                };
            }
        }

        const response = await fetch(url, config);

        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}`;
            try {
                // Parse the backend error payload: {"error":{"message":"invalid credentials"}}
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