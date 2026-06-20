import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Res,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { UsersAdminService } from './users-admin.service';
import {
  GetUsersQueryDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/users-admin.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Roles } from '@modules/auth/decorators/roles.decorator';
import { PLATFORM_ROLES } from '@database/schema/enums';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { User } from '@database/schema';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...PLATFORM_ROLES)
export class UsersAdminController {
  constructor(private readonly usersAdminService: UsersAdminService) {}

  @Get()
  async getUsers(@Query() query: GetUsersQueryDto, @Res() res: FastifyReply) {
    const result = await this.usersAdminService.getUsers(query);
    return res.status(HttpStatus.OK).send({
      success: true,
      ...result,
    });
  }

  @Get(':id')
  async getUserDetails(@Param('id') id: string, @Res() res: FastifyReply) {
    const user = await this.usersAdminService.getUserDetails(id);
    return res.status(HttpStatus.OK).send({
      success: true,
      data: user,
    });
  }

  @Patch(':id/role')
  async updateRole(
    @CurrentUser() admin: User,
    @Param('id') targetId: string,
    @Body() dto: UpdateUserRoleDto,
    @Res() res: FastifyReply,
  ) {
    const user = await this.usersAdminService.updateRole(
      admin.id,
      targetId,
      dto.role,
    );
    return res.status(HttpStatus.OK).send({
      success: true,
      message: 'User role updated successfully',
      data: user,
    });
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') targetId: string,
    @Body() dto: UpdateUserStatusDto,
    @Res() res: FastifyReply,
  ) {
    const user = await this.usersAdminService.updateStatus(
      targetId,
      dto.status,
    );
    return res.status(HttpStatus.OK).send({
      success: true,
      message: 'User status updated successfully',
      data: user,
    });
  }

  @Get(':id/orders')
  async getUserOrders(@Param('id') id: string, @Res() res: FastifyReply) {
    const orders = await this.usersAdminService.getUserOrders(id);
    return res.status(HttpStatus.OK).send({
      success: true,
      data: orders,
    });
  }
}
