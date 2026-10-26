/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Reflector } from '@nestjs/core';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwtStrategy, JwtPayload } from '../strategies/jwt.strategy';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role, PLATFORM_ROLES } from '@database/schema/enums';
import { User } from '@database/schema';

describe('Authentication & Role-Based Authorization Security (TASK-05)', () => {
  const jwtSecret = 'test-secret-at-least-32-chars-long-for-tests-123!';
  let jwtStrategy: JwtStrategy;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;
  let mockUsersStore: {
    findById: jest.Mock;
  };
  let mockConfigService: {
    jwtSecret: string;
  };

  const mockAdminUser: User = {
    id: 'admin-uuid-001',
    email: 'admin@gramoz.com',
    role: Role.ADMIN,
    status: 'active',
    fullName: 'Gramoz Admin',
    isEmailVerified: true,
    isPhoneVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  const mockSuperAdminUser: User = {
    id: 'super-uuid-001',
    email: 'super@gramoz.com',
    role: Role.SUPER_ADMIN,
    status: 'active',
    fullName: 'Gramoz Super Admin',
    isEmailVerified: true,
    isPhoneVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  const mockCustomerUser: User = {
    id: 'cust-uuid-001',
    email: 'customer@gramoz.com',
    role: Role.CUSTOMER,
    status: 'active',
    fullName: 'Gramoz Customer',
    isEmailVerified: true,
    isPhoneVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  const mockSuspendedUser: User = {
    id: 'susp-uuid-001',
    email: 'suspended@gramoz.com',
    role: Role.ADMIN,
    status: 'suspended',
    fullName: 'Suspended Admin',
    isEmailVerified: true,
    isPhoneVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  beforeEach(() => {
    mockConfigService = {
      jwtSecret,
    };

    mockUsersStore = {
      findById: jest.fn(),
    };

    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector, mockUsersStore as any);
    jwtStrategy = new JwtStrategy(
      mockConfigService as any,
      mockUsersStore as any,
    );
  });

  function createMockExecutionContext(
    user?: User | null,
    handlerRoles?: string[],
    classRoles?: string[],
  ): ExecutionContext {
    const mockRequest = {
      user: user ?? null,
      headers: {},
      cookies: {},
    };

    const handler = () => {};
    const targetClass = class {};

    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === ROLES_KEY) {
        return handlerRoles ?? classRoles ?? undefined;
      }
      return undefined;
    });

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => ({}),
      }),
      getHandler: () => handler,
      getClass: () => targetClass,
    } as unknown as ExecutionContext;
  }

  describe('JWT Strategy & Session Validation (Backend Layer)', () => {
    it('validates and extracts active user when valid payload is passed', async () => {
      mockUsersStore.findById.mockResolvedValueOnce(mockAdminUser);

      const payload: JwtPayload = {
        sub: mockAdminUser.id,
        email: mockAdminUser.email,
        role: mockAdminUser.role,
        token_type: 'access',
      };

      const result = await jwtStrategy.validate(payload);
      expect(result).toEqual(mockAdminUser);
      expect(mockUsersStore.findById).toHaveBeenCalledWith(mockAdminUser.id);
    });

    it('rejects access if user is not found in database', async () => {
      mockUsersStore.findById.mockResolvedValueOnce(null);

      const payload: JwtPayload = {
        sub: 'non-existent-user-id',
        email: 'ghost@gramoz.com',
        token_type: 'access',
      };

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects access when user status is suspended', async () => {
      mockUsersStore.findById.mockResolvedValueOnce(mockSuspendedUser);

      const payload: JwtPayload = {
        sub: mockSuspendedUser.id,
        email: mockSuspendedUser.email,
        token_type: 'access',
      };

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects access when user status is deleted', async () => {
      mockUsersStore.findById.mockResolvedValueOnce({
        ...mockCustomerUser,
        status: 'deleted',
      });

      const payload: JwtPayload = {
        sub: mockCustomerUser.id,
        email: mockCustomerUser.email,
        token_type: 'access',
      };

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects access when refresh token is presented as access token', async () => {
      const payload: JwtPayload = {
        sub: mockAdminUser.id,
        email: mockAdminUser.email,
        role: mockAdminUser.role,
        token_type: 'refresh',
      };

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(
        new UnauthorizedException(
          'Invalid or missing token type; access token required',
        ),
      );
      expect(mockUsersStore.findById).not.toHaveBeenCalled();
    });

    it('rejects access when JWT lacks token_type (legacy pre-TASK-16F token)', async () => {
      const payload: JwtPayload = {
        sub: mockAdminUser.id,
        email: mockAdminUser.email,
        role: mockAdminUser.role,
      };

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(
        new UnauthorizedException(
          'Invalid or missing token type; access token required',
        ),
      );
      expect(mockUsersStore.findById).not.toHaveBeenCalled();
    });

    it('rejects access when JWT has unknown or malformed token_type', async () => {
      const payload: JwtPayload = {
        sub: mockAdminUser.id,
        email: mockAdminUser.email,
        role: mockAdminUser.role,
        token_type: 'unknown_type',
      };

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(
        new UnauthorizedException(
          'Invalid or missing token type; access token required',
        ),
      );
      expect(mockUsersStore.findById).not.toHaveBeenCalled();
    });

    it('cryptographically rejects expired JWT token', () => {
      const expiredToken = jwt.sign(
        { sub: 'usr-1', email: 'test@gramoz.com' },
        jwtSecret,
        { expiresIn: '-10s' },
      );

      expect(() => {
        jwt.verify(expiredToken, jwtSecret);
      }).toThrow(jwt.TokenExpiredError);
    });

    it('cryptographically rejects token with tampered signature', () => {
      const validToken = jwt.sign(
        { sub: 'usr-1', email: 'test@gramoz.com' },
        jwtSecret,
        { expiresIn: '1h' },
      );

      const tamperedToken = validToken.slice(0, -4) + 'XXXX';

      expect(() => {
        jwt.verify(tamperedToken, jwtSecret);
      }).toThrow(jwt.JsonWebTokenError);
    });

    it('cryptographically rejects token signed with wrong secret key', () => {
      const forgedToken = jwt.sign(
        { sub: 'usr-1', email: 'admin@gramoz.com', role: Role.ADMIN },
        'attacker-controlled-secret-key-32-chars!',
        { expiresIn: '1h' },
      );

      expect(() => {
        jwt.verify(forgedToken, jwtSecret);
      }).toThrow(jwt.JsonWebTokenError);
    });
  });

  describe('RolesGuard Enforcement (Administrative Authorization Layer)', () => {
    it('allows access to route with no required roles metadata', async () => {
      const context = createMockExecutionContext(mockCustomerUser, undefined);
      await expect(rolesGuard.canActivate(context)).resolves.toBe(true);
    });

    it('throws ForbiddenException if user is not authenticated on a role-protected route', async () => {
      const context = createMockExecutionContext(null, [Role.ADMIN]);
      await expect(rolesGuard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('blocks normal customer from administrative routes', async () => {
      const context = createMockExecutionContext(mockCustomerUser, [
        Role.ADMIN,
        Role.SUPER_ADMIN,
      ]);
      await expect(rolesGuard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('permits administrator to access admin-only routes', async () => {
      mockUsersStore.findById.mockResolvedValueOnce(mockAdminUser);
      const context = createMockExecutionContext(mockAdminUser, [
        Role.ADMIN,
        Role.SUPER_ADMIN,
      ]);
      await expect(rolesGuard.canActivate(context)).resolves.toBe(true);
    });

    it('permits super_admin on all platform administrative routes', async () => {
      mockUsersStore.findById.mockResolvedValueOnce(mockSuperAdminUser);
      const context = createMockExecutionContext(mockSuperAdminUser, [
        ...PLATFORM_ROLES,
      ]);
      await expect(rolesGuard.canActivate(context)).resolves.toBe(true);
    });

    it('strictly enforces super_admin only routes against normal admin', async () => {
      mockUsersStore.findById.mockResolvedValueOnce(mockAdminUser);
      const context = createMockExecutionContext(mockAdminUser, [
        Role.SUPER_ADMIN,
      ]);
      await expect(rolesGuard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('immediately reflects role revocation on subsequent requests', async () => {
      // Step 1: User initially has ADMIN role in DB
      mockUsersStore.findById.mockResolvedValueOnce({
        ...mockAdminUser,
        role: Role.ADMIN,
      });

      const userAfterLogin = await jwtStrategy.validate({
        sub: mockAdminUser.id,
        email: mockAdminUser.email,
        token_type: 'access',
      });
      const context1 = createMockExecutionContext(userAfterLogin, [Role.ADMIN]);
      mockUsersStore.findById.mockResolvedValueOnce({
        ...mockAdminUser,
        role: Role.ADMIN,
      });
      await expect(rolesGuard.canActivate(context1)).resolves.toBe(true);

      // Step 2: Role is revoked in DB to CUSTOMER
      mockUsersStore.findById.mockResolvedValueOnce({
        ...mockAdminUser,
        role: Role.CUSTOMER,
      });

      const userAfterRevocation = await jwtStrategy.validate({
        sub: mockAdminUser.id,
        email: mockAdminUser.email,
        token_type: 'access',
      });
      const context2 = createMockExecutionContext(userAfterRevocation, [
        Role.ADMIN,
      ]);
      mockUsersStore.findById.mockResolvedValueOnce({
        ...mockAdminUser,
        role: Role.CUSTOMER,
      });
      await expect(rolesGuard.canActivate(context2)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
