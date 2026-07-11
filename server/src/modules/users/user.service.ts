import { Injectable } from '@nestjs/common';
import { UsersStore } from './users.store';

@Injectable()
export class UserService {
  constructor(private readonly usersStore: UsersStore) {}
}
