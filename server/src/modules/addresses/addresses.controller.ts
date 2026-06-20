import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { User } from '@database/schema';

@Controller('addresses')
@UseGuards(JwtAuthGuard)
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Post()
  async create(
    @CurrentUser() user: User,
    @Body() createAddressDto: CreateAddressDto,
  ) {
    const address = await this.addressesService.create(
      user.id,
      createAddressDto,
    );
    return { success: true, data: address };
  }

  @Get()
  async findAll(@CurrentUser() user: User) {
    const addresses = await this.addressesService.findAll(user.id);
    return { success: true, data: addresses };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: User) {
    const address = await this.addressesService.findOne(id, user.id);
    return { success: true, data: address };
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() updateAddressDto: UpdateAddressDto,
  ) {
    const address = await this.addressesService.update(
      id,
      user.id,
      updateAddressDto,
    );
    return { success: true, data: address };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string, @CurrentUser() user: User) {
    await this.addressesService.remove(id, user.id);
    return { success: true, message: 'Address deleted successfully' };
  }

  @Put(':id/default')
  async setDefault(@Param('id') id: string, @CurrentUser() user: User) {
    const address = await this.addressesService.setDefault(id, user.id);
    return { success: true, data: address };
  }
}
