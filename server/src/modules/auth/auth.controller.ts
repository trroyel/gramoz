import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Res,
  Req,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ConfigService } from '@config/config.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { User } from '@database/schema';

/** Max-age of the auth cookie — matches JWT_REFRESH_EXPIRES_IN (7 days) */
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.authService.login(dto);

    // Set short-lived access token cookie
    res.setCookie('access_token', result.data.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 15 * 60, // 15 minutes
    });

    // Set long-lived refresh token cookie
    res.setCookie('refresh_token', result.data.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });

    return result;
  }

  // Tight but reasonable: 10 refreshes/min covers multiple devices and background
  // tab renewals. Prevents a stolen refresh token from being used indefinitely.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('refresh')
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const oldRefreshToken = req.cookies['refresh_token'];
    const result = await this.authService.refreshToken(oldRefreshToken || '');

    // Set new short-lived access token cookie
    res.setCookie('access_token', result.data.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 15 * 60, // 15 minutes
    });

    // Set new long-lived refresh token cookie
    res.setCookie('refresh_token', result.data.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });

    return result;
  }

  /**
   * POST /auth/logout
   * Clears the httpOnly auth cookies server-side.
   */
  @SkipThrottle()
  @Post('logout')
  async logout(@Res({ passthrough: true }) res: FastifyReply) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    return { success: true, message: 'Logged out successfully' };
  }

  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('resend-verification')
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @SkipThrottle()
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: User) {
    return this.authService.getMe(user);
  }

  // ─── Google OAuth (manual — Fastify-compatible) ──────────────────────────

  /**
   * Step 1 — Redirect the browser to Google's consent screen.
   * We build the URL manually so we never touch Express-only Passport middleware.
   *
   * CSRF protection: a cryptographically random `state` nonce is generated here,
   * stored in a short-lived signed httpOnly cookie, and included in the redirect
   * URL. The callback verifies the nonce before exchanging the auth code.
   */
  @SkipThrottle()
  @Get('google')
  async googleLogin(@Res() res: FastifyReply) {
    // Generate a 16-byte (128-bit) random nonce — sufficient for CSRF protection
    const state = randomBytes(16).toString('hex');

    // Store in a signed httpOnly cookie so JS cannot tamper with it.
    // 5-minute TTL matches the maximum time a user should spend on Google's consent screen.
    res.setCookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 300, // 5 minutes
      signed: true,
    });

    const params = new URLSearchParams({
      client_id: this.config.googleClientId,
      redirect_uri: this.config.googleCallbackUrl,
      response_type: 'code',
      scope: 'email profile',
      access_type: 'online',
      state,
    });
    const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return res.code(302).header('Location', googleUrl).send();
  }

  /**
   * Step 2 — Google redirects back here with ?code=... and ?state=...
   * Verify the CSRF state nonce, then exchange the code for tokens.
   */
  @SkipThrottle()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Query('state') state: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const redirect = (url: string) =>
      res.code(302).header('Location', url).send();

    if (error || !code) {
      return redirect(`${this.config.frontendUrl}/login?error=oauth_denied`);
    }

    // ── CSRF State Verification ──────────────────────────────────────────────
    // Retrieve the signed nonce we stored in googleLogin. If the cookie is
    // absent, expired, or tampered with, unsignCookie returns { valid: false }.
    const unsignedState = req.unsignCookie(req.cookies['oauth_state'] ?? '');
    const storedState = unsignedState.valid ? unsignedState.value : null;

    // Always clear the one-time cookie regardless of outcome
    res.clearCookie('oauth_state', { path: '/' });

    if (!storedState || !state || storedState !== state) {
      this.logger.warn(
        '[Google OAuth] State mismatch — possible CSRF attempt. ' +
        `Expected: ${storedState ?? 'missing'}, Got: ${state ?? 'missing'}`,
      );
      return redirect(`${this.config.frontendUrl}/login?error=oauth_state_mismatch`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    try {
      // Exchange authorisation code for Google access token
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.config.googleClientId,
          client_secret: this.config.googleClientSecret,
          redirect_uri: this.config.googleCallbackUrl,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = (await tokenRes.json()) as any;
      if (!tokenData.access_token) {
        throw new Error('No access_token received from Google');
      }

      // Fetch the user's profile from Google
      const profileRes = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
      );
      const profile = (await profileRes.json()) as any;

      const { accessToken, refreshToken } =
        await this.authService.validateOAuthUser({
          googleId: profile.id,
          email: profile.email,
          fullName: profile.name,
          picture: profile.picture,
        });

      res.setCookie('access_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 15 * 60,
      });
      res.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: COOKIE_MAX_AGE_SECONDS,
      });

      return redirect(
        `${this.config.frontendUrl}/auth/callback?provider=google`,
      );
    } catch (err) {
      this.logger.error('[Google OAuth] Callback error:', err);
      return redirect(`${this.config.frontendUrl}/login?error=oauth_failed`);
    }
  }
}
