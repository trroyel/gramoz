import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UsersStore } from './users.store';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';

@Module({
  controllers: [UserController, UsersAdminController],
  providers: [UserService, UsersStore, UsersAdminService],
  exports: [UserService, UsersStore],
})
export class UserModule {}
