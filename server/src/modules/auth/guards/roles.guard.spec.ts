import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UsersStore } from '@modules/users/users.store';
import { User } from '@database/schema';

describe('RolesGuard Unit Tests (Security Invariants SEC-09-B & SEC-09-D)', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;
  let mockUsersStore: jest.Mocked<UsersStore>;

  const mockAdminUser: User = {
    id: 'user-admin-1',
    email: 'admin@gramoz.com',
    passwordHash: 'hash',
    fullName: 'Admin User',
    phone: null,
    avatarUrl: null,
    provider: 'local',
    providerId: null,
    role: 'admin',
    isEmailVerified: true,
    isPhoneVerified: false,
    status: 'active',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockCustomerUser: User = {
    id: 'user-cust-1',
    email: 'customer@gramoz.com',
    passwordHash: 'hash',
    fullName: 'Customer User',
    phone: null,
    avatarUrl: null,
    provider: 'local',
    providerId: null,
    role: 'customer',
    isEmailVerified: true,
    isPhoneVerified: false,
    status: 'active',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const createMockContext = (user?: Partial<User>): ExecutionContext => {
    const req = { user };
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(req),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    mockUsersStore = {
      findById: jest.fn(),
      invalidateUserCache: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<UsersStore>;

    guard = new RolesGuard(reflector, mockUsersStore);
  });

  describe('Unrestricted and Customer Routes', () => {
    it('allows access when no roles are required on route', async () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const ctx = createMockContext();

      const canActivate = await guard.canActivate(ctx);
      expect(canActivate).toBe(true);
      expect(mockUsersStore.findById).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated request when roles are required', async () => {
      reflector.getAllAndOverride.mockReturnValue(['customer']);
      const ctx = createMockContext(undefined);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('fast-rejects when user does not possess required role', async () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const ctx = createMockContext(mockCustomerUser);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      // Fast-reject does not need to query the database
      expect(mockUsersStore.findById).not.toHaveBeenCalled();
    });

    it('allows customer access from cached user without querying DB', async () => {
      reflector.getAllAndOverride.mockReturnValue(['customer']);
      const ctx = createMockContext(mockCustomerUser);

      const canActivate = await guard.canActivate(ctx);
      expect(canActivate).toBe(true);
      // Customer routes are NOT platform operations; DB query is skipped for performance
      expect(mockUsersStore.findById).not.toHaveBeenCalled();
    });
  });

  describe('Privileged Platform Operations (Authoritative Verification)', () => {
    it('allows platform access when database confirms active admin role', async () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const ctx = createMockContext(mockAdminUser);
      mockUsersStore.findById.mockResolvedValue(mockAdminUser);

      const canActivate = await guard.canActivate(ctx);
      expect(canActivate).toBe(true);
      expect(mockUsersStore.findById).toHaveBeenCalledWith(mockAdminUser.id, {
        skipCache: true,
      });
    });

    it('SEC-09-B: blocks access when DB mutation succeeded but Redis cache retained admin role', async () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      // Scenario: Cache still says user is 'admin', but DB has role='customer' (demoted)
      const ctx = createMockContext(mockAdminUser);
      const demotedDbUser: User = { ...mockAdminUser, role: 'customer' };
      mockUsersStore.findById.mockResolvedValue(demotedDbUser);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);

      // Must have performed authoritative check
      expect(mockUsersStore.findById).toHaveBeenCalledWith(mockAdminUser.id, {
        skipCache: true,
      });

      // Must trigger self-healing cache invalidation
      expect(mockUsersStore.invalidateUserCache).toHaveBeenCalledWith(
        mockAdminUser.id,
      );
    });

    it('SEC-09-D: blocks access when user was suspended in DB even if token claims admin', async () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const ctx = createMockContext(mockAdminUser);
      const suspendedDbUser: User = {
        ...mockAdminUser,
        status: 'suspended',
      };
      mockUsersStore.findById.mockResolvedValue(suspendedDbUser);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);

      // Must trigger self-healing cache invalidation
      expect(mockUsersStore.invalidateUserCache).toHaveBeenCalledWith(
        mockAdminUser.id,
      );
    });

    it('blocks access when user was deleted from DB', async () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const ctx = createMockContext(mockAdminUser);
      mockUsersStore.findById.mockResolvedValue(undefined);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('strictly fails closed and throws ForbiddenException if usersStore is omitted for platform operations', async () => {
      const guardWithoutStore = new RolesGuard(reflector);
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const ctx = createMockContext(mockAdminUser);

      await expect(guardWithoutStore.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException(
          'Authoritative authorization store unavailable for privileged operation',
        ),
      );
    });

    it('strictly fails closed and throws ForbiddenException if database throws an error during verification', async () => {
      reflector.getAllAndOverride.mockReturnValue(['admin']);
      const ctx = createMockContext(mockAdminUser);
      mockUsersStore.findById.mockRejectedValue(
        new Error('PostgreSQL connection timeout'),
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException(
          'Authoritative database verification failed. Privileged access denied.',
        ),
      );
    });

    it('permits non-platform operations even if usersStore is omitted', async () => {
      const guardWithoutStore = new RolesGuard(reflector);
      reflector.getAllAndOverride.mockReturnValue(['customer']);
      const ctx = createMockContext(mockCustomerUser);

      const canActivate = await guardWithoutStore.canActivate(ctx);
      expect(canActivate).toBe(true);
    });
  });
});
