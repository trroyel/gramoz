import { Module } from '@nestjs/common';

import { ConfigModule } from '@config/config.module';
import { DatabaseModule } from '@database/database.module';
import { RedisModule } from '@cache/redis.module';
import { AuthModule } from '@modules/auth/auth.module';
import { UserModule } from '@modules/users/user.module';
import { ProductsModule } from '@modules/products/products.module';

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, AuthModule, UserModule, ProductsModule],
  controllers: [],
  providers: [],
})
export class AppModule { }
