import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { PromosService } from '../../promos.service';
import { CreatePromoDto } from '../../dto/create-promo.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Roles } from '@modules/auth/decorators/roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Role } from '@database/schema';
import type { User } from '@database/schema';

@Controller('admin/promos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class PromosAdminController {
  constructor(private readonly promosService: PromosService) {}

  @Post()
  async create(@Body() dto: CreatePromoDto) {
    const promo = await this.promosService.create(dto);
    return { success: true, data: promo };
  }

  @Get()
  async findAll() {
    const promos = await this.promosService.findAll();
    return { success: true, data: promos };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const promo = await this.promosService.findOne(id);
    return { success: true, data: promo };
  }

  @Put(':id/toggle')
  async toggleActive(@Param('id') id: string) {
    const promo = await this.promosService.toggleActive(id);
    return { success: true, data: promo };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.promosService.delete(id);
    return { success: true };
  }
}
