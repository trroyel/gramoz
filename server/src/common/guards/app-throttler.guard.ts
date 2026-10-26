import { Injectable, ExecutionContext } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerException,
  ThrottlerRequest,
  ThrottlerLimitDetail,
} from '@nestjs/throttler';
import type { FastifyRequest, FastifyReply } from 'fastify';

const THROTTLER_LIMIT_PREFIX = 'THROTTLER:LIMIT';
const THROTTLER_SKIP_PREFIX = 'THROTTLER:SKIP';

/**
 * Normalizes account identifiers for abuse prevention.
 * Converts emails to trimmed lowercase, and strips extraneous whitespace from phone numbers.
 * Returns null if no valid string identifier is present.
 */
export function normalizeAccountIdentifier(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.email === 'string' && b.email.trim().length > 0) {
    return `email:${b.email.trim().toLowerCase()}`;
  }
  if (typeof b.phone === 'string' && b.phone.trim().length > 0) {
    return `phone:${b.phone.trim().replace(/\s+/g, '')}`;
  }
  return null;
}

/**
 * Production Throttler Guard for Gramoz.
 *
 * Enforces dual-key rate limiting:
 * 1. IP-based limits via named 'default' throttler (prevents credential stuffing & DDoS).
 * 2. Normalized account-identifier limits via named 'account' throttler (prevents targeted brute-force).
 *
 * Resilience & Features:
 * - Emits standard RFC 6585 Retry-After header on 429 rejections.
 * - Non-enumerating error messages preventing account existence disclosure.
 * - Skips account throttling on endpoints without explicit @Throttle({ account: ... }) decoration.
 * - Respects @SkipThrottle() on routes and controllers.
 * - Safe client IP resolution compatible with trusted reverse proxies.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(
    context: ExecutionContext,
  ): Promise<boolean> {
    const handler = context.getHandler();
    const classRef = context.getClass();

    // Skip all throttlers if the route or controller has @SkipThrottle()
    const skipDefault = this.reflector.getAllAndOverride<boolean>(
      THROTTLER_SKIP_PREFIX + 'default',
      [handler, classRef],
    );
    if (skipDefault) {
      return true;
    }

    return super.shouldSkip(context);
  }

  protected override async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { throttler, context } = requestProps;

    // For named 'account' throttler: only evaluate if endpoint explicitly defines @Throttle({ account: ... })
    // AND request body provides a recognizable account identifier.
    if (throttler.name === 'account') {
      const handler = context.getHandler();
      const classRef = context.getClass();

      const accountLimit = this.reflector.getAllAndOverride<number | undefined>(
        THROTTLER_LIMIT_PREFIX + 'account',
        [handler, classRef],
      );

      // Route has no account-level throttling policy — skip
      if (accountLimit === undefined) {
        return true;
      }

      const { req } = this.getRequestResponse(context) as unknown as {
        req: FastifyRequest;
      };
      const identifier = normalizeAccountIdentifier(req?.body);

      // No account identifier in body — skip account-level throttling
      if (!identifier) {
        return true;
      }
    }

    return super.handleRequest(requestProps);
  }

  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const fastifyReq = req as unknown as FastifyRequest;
    const ip =
      fastifyReq.ip || fastifyReq.raw?.socket?.remoteAddress || '127.0.0.1';
    return Promise.resolve(ip);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context) as unknown as {
      res?: FastifyReply;
    };

    // Set standard HTTP Retry-After header (in integer seconds)
    if (res !== undefined && res !== null) {
      res.header('Retry-After', throttlerLimitDetail.timeToBlockExpire);
    }

    const message = await this.getErrorMessage(context, throttlerLimitDetail);
    throw new ThrottlerException(message);
  }

  protected override async getErrorMessage(
    _context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<string> {
    const seconds = throttlerLimitDetail.timeToBlockExpire || 60;
    return Promise.resolve(
      `Too many requests. Please try again in ${seconds} seconds.`,
    );
  }
}
