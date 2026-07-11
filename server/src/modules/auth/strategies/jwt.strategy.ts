import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { FastifyRequest } from 'fastify';
import { ConfigService } from '@config/config.service';
import { UsersStore } from '@modules/users/users.store';

export interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * Extracts JWT from the request using cookie-first strategy:
 *   1. httpOnly cookie named 'access_token'  (browser — XSS-safe)
 *   2. Authorization: Bearer <token>          (REST clients / mobile)
 */
function cookieOrBearerExtractor(req: FastifyRequest): string | null {
  const cookie = (req.cookies as Record<string, string>)?.['access_token'];
  if (cookie) return cookie;
  const auth = req.headers?.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly usersStore: UsersStore,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieOrBearerExtractor as any,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersStore.findById(payload.sub);

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid token or user inactive');
    }

    return user;
  }
}
