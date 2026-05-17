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
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import * as fs from 'fs';
import * as util from 'util';
import { pipeline } from 'stream';
import { extname } from 'path';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Roles } from '@modules/auth/decorators/roles.decorator';

const pump = util.promisify(pipeline);

// Ensure upload directory exists
const uploadDir = './public/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin', 'seller')
  async create(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    if (!req.isMultipart()) {
      return res
        .status(400)
        .send({ success: false, message: 'Request is not multipart' });
    }

    let name: string = '';
    let price: number = 0;
    let stock: number = 0;
    let description: string | undefined = undefined;
    let categoryId: string | undefined = undefined;
    let imageUrl: string | undefined = undefined;

    const parts = req.parts();

    for await (const part of parts) {
      if (part.type === 'file' && part.filename) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = extname(part.filename);
        const filename = `${part.fieldname}-${uniqueSuffix}${ext}`;
        const dest = `${uploadDir}/${filename}`;

        await pump(part.file, fs.createWriteStream(dest));
        imageUrl = `/public/uploads/${filename}`;
      } else if (part.type === 'field') {
        if (part.fieldname === 'name') name = String(part.value);
        if (part.fieldname === 'price') price = Number(part.value);
        if (part.fieldname === 'stock') stock = Number(part.value);
        if (part.fieldname === 'description') description = String(part.value);
        if (part.fieldname === 'categoryId') categoryId = String(part.value);
      }
    }

    if (!name || isNaN(price) || isNaN(stock)) {
      return res.status(400).send({
        success: false,
        message: 'Missing required fields or invalid types',
      });
    }

    const createProductDto = { name, price, stock, description, categoryId };
    const product = await this.productsService.create(
      createProductDto,
      imageUrl,
    );

    return res.send({
      success: true,
      message: 'Product created successfully',
      data: product,
    });
  }

  @Get()
  async findAll(@Query() query: any, @Res() res: FastifyReply) {
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
  @Roles('super_admin', 'admin', 'seller')
  async update(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    if (!req.isMultipart()) {
      return res
        .status(400)
        .send({ success: false, message: 'Request is not multipart' });
    }

    const product = await this.productsService.findOne(id);
    if (!product) {
      return res
        .status(404)
        .send({ success: false, message: 'Product not found' });
    }

    let name: string | undefined;
    let price: number | undefined;
    let stock: number | undefined;
    let description: string | undefined;
    let categoryId: string | undefined;
    let imageUrl: string | undefined;

    const parts = req.parts();

    for await (const part of parts) {
      if (part.type === 'file' && part.filename) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = extname(part.filename);
        const filename = `${part.fieldname}-${uniqueSuffix}${ext}`;
        const dest = `${uploadDir}/${filename}`;

        await pump(part.file, fs.createWriteStream(dest));
        imageUrl = `/public/uploads/${filename}`;
      } else if (part.type === 'field') {
        if (part.fieldname === 'name') name = String(part.value);
        if (part.fieldname === 'price') price = Number(part.value);
        if (part.fieldname === 'stock') stock = Number(part.value);
        if (part.fieldname === 'description') description = String(part.value);
        if (part.fieldname === 'categoryId') categoryId = String(part.value);
      }
    }

    const updateDto = { name, price, stock, description, categoryId };
    const updatedProduct = await this.productsService.update(
      id,
      updateDto,
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
  @Roles('super_admin', 'admin')
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
