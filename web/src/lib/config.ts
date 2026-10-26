/**
 * Gramoz Web Frontend Configuration & Environment Management
 *
 * Enforces strict separation between:
 * 1. Server-only internal backend origin (INTERNAL_API_URL / BACKEND_INTERNAL_URL)
 *    used by Next.js rewrites and SSR. Never exposed to browser bundles.
 * 2. Browser-accessible endpoints (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SERVER_URL).
 * 3. Media storage providers (Cloudflare R2, Unsplash, local disk).
 */

export interface RemotePatternConfig {
  protocol: "http" | "https";
  hostname: string;
  port?: string;
  pathname?: string;
}

/**
 * Resolves the backend origin for Next.js rewrites and internal Node.js requests.
 *
 * In production (NODE_ENV=production):
 * - Requires INTERNAL_API_URL (or BACKEND_INTERNAL_URL).
 * - Rejects missing or malformed configuration with a descriptive error.
 * - Does not silently default to localhost:5000.
 *
 * In development / test:
 * - Falls back to http://localhost:5000 if unset for seamless DX.
 *
 * Normalizes input: extracts the pure origin (protocol + host + port), stripping
 * any extraneous paths or trailing slashes so rewrite destinations are clean.
 */
export function resolveBackendOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const isProduction = env.NODE_ENV === "production";
  const rawUrl = env.INTERNAL_API_URL || env.BACKEND_INTERNAL_URL;

  if (!rawUrl || rawUrl.trim() === "") {
    if (isProduction) {
      throw new Error(
        "[Gramoz Config Error] INTERNAL_API_URL is required in production. " +
          "Frontend rewrites and server-side calls cannot silently default to localhost:5000."
      );
    }
    return "http://localhost:5000";
  }

  const trimmed = rawUrl.trim();

  try {
    const parsed = new URL(trimmed);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `[Gramoz Config Error] INTERNAL_API_URL must use http: or https: protocol. Received: "${parsed.protocol}"`
      );
    }

    if (!parsed.hostname) {
      throw new Error(
        `[Gramoz Config Error] INTERNAL_API_URL must specify a valid hostname. Received: "${trimmed}"`
      );
    }

    // Return pure origin (e.g., http://backend:5000 or https://api.gramoz.com)
    return parsed.origin;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.message.startsWith("[Gramoz Config Error]")) {
      throw err;
    }
    throw new Error(
      `[Gramoz Config Error] Invalid URL format for INTERNAL_API_URL: "${trimmed}". Error: ${err.message}`
    );
  }
}

/**
 * Resolves the full internal API base URL for server-side HTTP clients (SSR / Server Components).
 * Automatically preserves any existing path (e.g. /api/v1) or appends the default /api/v1.
 */
export function resolveInternalApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const origin = resolveBackendOrigin(env);
  const rawUrl = env.INTERNAL_API_URL || env.BACKEND_INTERNAL_URL;

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.pathname && parsed.pathname !== "/") {
        return `${origin}${parsed.pathname.replace(/\/+$/, "")}`;
      }
    } catch {
      // Errors handled during resolveBackendOrigin
    }
  }

  return `${origin}/api/v1`;
}

/**
 * Resolves the public API path for client-side browser requests.
 * Defaults to relative path '/api/v1' which is routed through Next.js rewrites.
 */
export function resolvePublicApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.NEXT_PUBLIC_API_URL || "/api/v1";
}

/**
 * Resolves the public backend server URL (optional, used for direct OAuth redirects).
 * Returns empty string if frontend and backend share an ingress / reverse proxy.
 */
export function resolvePublicServerUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.NEXT_PUBLIC_SERVER_URL || "";
}

/**
 * Resolves narrow, explicit remote image patterns for Next.js image optimization.
 * Supports Cloudflare R2 (media.gramoz.com), Unsplash, custom MEDIA_URL, and dev localhost.
 */
export function resolveImageRemotePatterns(
  env: NodeJS.ProcessEnv = process.env
): RemotePatternConfig[] {
  const patterns: RemotePatternConfig[] = [
    {
      protocol: "https",
      hostname: "images.unsplash.com",
    },
    {
      protocol: "https",
      hostname: "media.gramoz.com",
    },
  ];

  // Optional custom media CDN / R2 storage bucket public URL
  const customMediaUrl =
    env.MEDIA_URL || env.NEXT_PUBLIC_MEDIA_URL || env.R2_PUBLIC_URL;

  if (customMediaUrl && customMediaUrl.trim() !== "") {
    try {
      const parsed = new URL(customMediaUrl.trim());
      const protocol = parsed.protocol.replace(":", "") as "http" | "https";
      const hostname = parsed.hostname;
      const port = parsed.port || undefined;

      const alreadyExists = patterns.some(
        (p) => p.hostname === hostname && p.protocol === protocol && p.port === port
      );

      if (!alreadyExists && hostname) {
        patterns.push({
          protocol,
          hostname,
          ...(port ? { port } : {}),
          pathname: "/**",
        });
      }
    } catch {
      // Invalid media URL ignored in pattern generator
    }
  }

  // Development and testing environments allow local media hosting
  if (env.NODE_ENV !== "production") {
    patterns.push(
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
      }
    );
  }

  return patterns;
}
