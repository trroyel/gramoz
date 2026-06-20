import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@config/config.service';

export interface GoogleProfile {
  googleId: string;
  email: string;
  fullName: string;
  picture?: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly config: ConfigService) {
    super({
      clientID: config.googleClientId,
      clientSecret: config.googleClientSecret,
      callbackURL: config.googleCallbackUrl,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<void> {
    const { id, displayName, emails, photos } = profile;

    const googleProfile: GoogleProfile = {
      googleId: id,
      email: emails?.[0]?.value ?? '',
      fullName: displayName,
      picture: photos?.[0]?.value,
    };

    done(null, googleProfile);
  }
}
