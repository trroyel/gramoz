import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Req,
  Res,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ProductsService } from './products.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Roles } from '@modules/auth/decorators/roles.decorator';
import { Role } from '@database/schema';
import { FindProductsQueryDto } from './dto/find-products-query.dto';
import { FastifyFileUploadInterceptor } from '../../common/interceptors/fastify-file-upload.interceptor';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly storageService: StorageService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  @UseInterceptors(FastifyFileUploadInterceptor)
  async create(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    const parsedBody = (req as any).parsedBody || {};
    const uploadedFile = (req as any).uploadedFile;

    const name = String(parsedBody.name || '');
    const price = Number(parsedBody.price);
    const stock = Number(parsedBody.stock);
    const description = parsedBody.description ? String(parsedBody.description) : undefined;
    const categoryId = parsedBody.categoryId ? String(parsedBody.categoryId) : undefined;
    const unit = parsedBody.unit ? String(parsedBody.unit) : undefined;

    let imageUrl: string | undefined;

    if (uploadedFile) {
      imageUrl = await this.storageService.upload(
        uploadedFile.file,
        uploadedFile.filename,
        uploadedFile.mimetype,
      );
    }

    if (!name || isNaN(price) || isNaN(stock)) {
      return res.status(400).send({
        success: false,
        message: 'Missing required fields: name, price, stock',
      });
    }

    const product = await this.productsService.create(
      { name, price, stock, description, categoryId, unit },
      imageUrl,
    );

    return res.status(201).send({
      success: true,
      message: 'Product created successfully',
      data: product,
    });
  }

  @Get()
  async findAll(@Query() query: FindProductsQueryDto, @Res() res: FastifyReply) {
    const products = await this.productsService.findAll(query);
    return res.send({
      success: true,
      message: 'Products retrieved successfully',
      data: products,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Res() res: FastifyReply) {
    const product = await this.productsService.findOne(id);
    if (!product) {
      return res
        .status(404)
        .send({ success: false, message: 'Product not found' });
    }
    return res.send({
      success: true,
      message: 'Product retrieved successfully',
      data: product,
    });
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  @UseInterceptors(FastifyFileUploadInterceptor)
  async update(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const product = await this.productsService.findOne(id);
    if (!product) {
      return res
        .status(404)
        .send({ success: false, message: 'Product not found' });
    }

    const parsedBody = (req as any).parsedBody || {};
    const uploadedFile = (req as any).uploadedFile;

    const name = parsedBody.name ? String(parsedBody.name) : undefined;
    const price = parsedBody.price !== undefined ? Number(parsedBody.price) : undefined;
    const stock = parsedBody.stock !== undefined ? Number(parsedBody.stock) : undefined;
    const description = parsedBody.description !== undefined ? String(parsedBody.description) : undefined;
    const categoryId = parsedBody.categoryId !== undefined ? String(parsedBody.categoryId) : undefined;
    const unit = parsedBody.unit !== undefined ? String(parsedBody.unit) : undefined;

    let imageUrl: string | undefined;

    if (uploadedFile) {
      imageUrl = await this.storageService.upload(
        uploadedFile.file,
        uploadedFile.filename,
        uploadedFile.mimetype,
      );
    }

    const updatedProduct = await this.productsService.update(
      id,
      { name, price, stock, description, categoryId, unit },
      imageUrl,
    );

    return res.send({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct,
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async remove(@Param('id') id: string, @Res() res: FastifyReply) {
    const product = await this.productsService.findOne(id);
    if (!product) {
      return res
        .status(404)
        .send({ success: false, message: 'Product not found' });
    }

    await this.productsService.delete(id);
    return res.send({
      success: true,
      message: 'Product deleted successfully',
    });
  }
}
