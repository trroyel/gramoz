import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { GetUsersQueryDto } from './dto/users-admin.dto';
import { UsersStore } from './users.store';

@Injectable()
export class UsersAdminService {
  constructor(
    private readonly usersStore: UsersStore,
  ) {}

  async getUsers(query: GetUsersQueryDto) {
    const {
      page = 1,
      limit = 10,
      query: search,
      role,
      status,
      sortBy,
      sortOrder,
    } = query;

    const result = await this.usersStore.getUsersWithStats(
      page,
      limit,
      search,
      role,
      status,
      sortBy,
      sortOrder
    );

    return {
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    };
  }

  async getUserDetails(id: string) {
    const user = await this.usersStore.getUserDetailsWithStats(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateRole(adminId: string, targetUserId: string, newRole: string) {
    if (adminId === targetUserId) {
      throw new BadRequestException(
        'You cannot modify your own role. This prevents accidental lockouts.',
      );
    }

    const user = await this.usersStore.update(targetUserId, { role: newRole as any });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateStatus(targetUserId: string, newStatus: string) {
    const user = await this.usersStore.update(targetUserId, { status: newStatus as any });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getUserOrders(userId: string) {
    const user = await this.usersStore.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    return this.usersStore.getUserOrders(userId);
  }
}
