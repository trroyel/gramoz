import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { User } from '@database/schema';
import { PLATFORM_ROLES } from '@database/schema/enums';
import { UsersStore } from '../../users/users.store';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Optional() private readonly usersStore?: UsersStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // No roles required, allow access
    }

    const req = context.switchToHttp().getRequest<{ user: User }>();
    const { user } = req;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Fast rejection: if the cached user does not possess required role, reject immediately (0ms)
    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Requires one of the following roles: ${requiredRoles.join(', ')}`,
      );
    }

    // Security Gate (SEC-09-B / SEC-09-D / SEC-09-E):
    // For privileged platform operations (admin, super_admin, support), an authoritative
    // database check is mandatory. This guarantees zero stale authorization windows even if
    // Redis cache invalidation failed or an outdated JWT is presented.
    const isPlatformOperation = requiredRoles.some((r) =>
      (PLATFORM_ROLES as readonly string[]).includes(r),
    );

    if (isPlatformOperation) {
      if (!this.usersStore) {
        throw new ForbiddenException(
          'Authoritative authorization store unavailable for privileged operation',
        );
      }

      let dbUser: User | undefined;
      try {
        dbUser = await this.usersStore.findById(user.id, {
          skipCache: true,
        });
      } catch {
        throw new ForbiddenException(
          'Authoritative database verification failed. Privileged access denied.',
        );
      }

      if (
        !dbUser ||
        dbUser.status !== 'active' ||
        !requiredRoles.includes(dbUser.role)
      ) {
        // If DB role or status diverged from cached state, self-heal cache immediately
        if (dbUser?.role !== user.role || dbUser?.status !== user.status) {
          await this.usersStore.invalidateUserCache(user.id).catch(() => {});
        }
        throw new ForbiddenException(
          `Access denied. Requires one of the following roles: ${requiredRoles.join(', ')}`,
        );
      }

      req.user = dbUser;
    }

    return true;
  }
}
