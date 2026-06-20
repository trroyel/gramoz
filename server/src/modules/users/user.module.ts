import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';

@Module({
  controllers: [UserController, UsersAdminController],
  providers: [UserService, UserRepository, UsersAdminService],
  exports: [UserService, UserRepository],
})
export class UserModule {}
