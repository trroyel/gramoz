import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Res,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Roles } from '@modules/auth/decorators/roles.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin', 'support')
  async create(@Body() dto: CreateCategoryDto, @Res() res: FastifyReply) {
    const category = await this.categoriesService.create(dto);
    return res.status(HttpStatus.CREATED).send({
      success: true,
      message: 'Category created successfully',
      data: category,
    });
  }

  @Get()
  async findAll(@Res() res: FastifyReply) {
    const categories = await this.categoriesService.findAll();
    return res.send({
      success: true,
      message: 'Categories retrieved successfully',
      data: categories,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Res() res: FastifyReply) {
    const category = await this.categoriesService.findOne(id);
    return res.send({
      success: true,
      message: 'Category retrieved successfully',
      data: category,
    });
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin', 'support')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateCategoryDto>,
    @Res() res: FastifyReply,
  ) {
    const category = await this.categoriesService.update(id, dto);
    return res.send({
      success: true,
      message: 'Category updated successfully',
      data: category,
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin')
  async remove(@Param('id') id: string, @Res() res: FastifyReply) {
    await this.categoriesService.remove(id);
    return res.send({
      success: true,
      message: 'Category deleted successfully',
    });
  }
}
