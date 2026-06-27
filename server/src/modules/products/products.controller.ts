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
  ParseUUIDPipe,
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
  ) { }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  @UseInterceptors(FastifyFileUploadInterceptor)
  async create(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    try {
      const parsedBody = (req as any).parsedBody || {};
      const uploadedFile = (req as any).uploadedFile;

      const name = String(parsedBody.name || '').trim();
      const priceRaw = parsedBody.price;
      const stockRaw = parsedBody.stock;
      const price = Number(priceRaw);
      const stock = Number(stockRaw);
      const description = parsedBody.description ? String(parsedBody.description) : undefined;
      const categoryId = parsedBody.categoryId ? String(parsedBody.categoryId) : undefined;
      const unit = parsedBody.unit ? String(parsedBody.unit) : undefined;

      // Validate BEFORE uploading to avoid wasted storage on bad input
      if (!name) {
        return res.status(400).send({ success: false, message: 'Product name is required' });
      }
      if (priceRaw === undefined || priceRaw === '' || isNaN(price) || price < 0) {
        return res.status(400).send({ success: false, message: 'Valid price is required' });
      }
      if (stockRaw === undefined || stockRaw === '' || isNaN(stock) || stock < 0) {
        return res.status(400).send({ success: false, message: 'Valid stock quantity is required' });
      }

      let imageUrl: string | undefined;
      if (uploadedFile) {
        imageUrl = await this.storageService.upload(
          uploadedFile.file,
          uploadedFile.filename,
          uploadedFile.mimetype,
        );
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
    } catch (err: any) {
      return res.status(500).send({
        success: false,
        error: { message: err?.message ?? 'Internal server error' },
      });
    }
  }

  @Get()
  async findAll(@Query() query: FindProductsQueryDto, @Res() res: FastifyReply) {
    const { data, meta } = await this.productsService.findAll(query);
    return res.send({
      success: true,
      message: 'Products retrieved successfully',
      data,
      meta,
    });
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Res() res: FastifyReply) {
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
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    try {
      const product = await this.productsService.findOne(id);
      if (!product) {
        return res.status(404).send({ success: false, message: 'Product not found' });
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
    } catch (err: any) {
      return res.status(500).send({
        success: false,
        error: { message: err?.message ?? 'Internal server error' },
      });
    }
  }


  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Res() res: FastifyReply) {
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
