/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ReviewsService } from './reviews.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FastifyFileUploadInterceptor } from '../../common/interceptors/fastify-file-upload.interceptor';

@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly storageService: StorageService,
  ) {}

  @Get('my')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async getMyReviews(
    @Req() req: FastifyRequest,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const user = (req as any).user;
    const data = await this.reviewsService.getMyReviews(
      user.id,
      parseInt(page) || 1,
      parseInt(limit) || 10,
    );
    return { success: true, data };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @UseInterceptors(FastifyFileUploadInterceptor)
  async submitReview(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    try {
      const user = (req as any).user;
      const parsedBody = (req as any).parsedBody || {};
      const uploadedFiles: Array<{
        filename: string;
        mimetype: string;
        file: any;
      }> =
        (req as any).uploadedFiles ||
        ((req as any).uploadedFile ? [(req as any).uploadedFile] : []);

      const orderId = parsedBody.orderId;
      const productId = parsedBody.productId;
      const rating = Number(parsedBody.rating);
      const comment = parsedBody.comment;

      const imageUrls: string[] = [];
      for (const file of uploadedFiles) {
        const imageUrl = await this.storageService.upload(
          file.file,
          file.filename,
          file.mimetype,
        );
        imageUrls.push(imageUrl);
      }

      const review = await this.reviewsService.submitReview(
        user.id,
        orderId,
        productId,
        rating,
        comment,
        imageUrls,
      );

      return res.status(201).send({
        success: true,
        message: 'Review submitted successfully',
        data: review,
      });
    } catch (err: any) {
      return res.status(err.status || 500).send({
        success: false,
        error: { message: err?.message ?? 'Internal server error' },
      });
    }
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @UseInterceptors(FastifyFileUploadInterceptor)
  async updateReview(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    try {
      const user = (req as any).user;
      const parsedBody = (req as any).parsedBody || {};
      const uploadedFiles: Array<{
        filename: string;
        mimetype: string;
        file: any;
      }> =
        (req as any).uploadedFiles ||
        ((req as any).uploadedFile ? [(req as any).uploadedFile] : []);

      let imageUrls: string[] | undefined;
      if (uploadedFiles.length > 0) {
        imageUrls = [];
        for (const file of uploadedFiles) {
          const imageUrl = await this.storageService.upload(
            file.file,
            file.filename,
            file.mimetype,
          );
          imageUrls.push(imageUrl);
        }
      }

      const rating =
        parsedBody.rating !== undefined ? Number(parsedBody.rating) : undefined;
      const comment =
        parsedBody.comment !== undefined
          ? String(parsedBody.comment)
          : undefined;

      const updated = await this.reviewsService.updateCustomerReview(
        user.id,
        id,
        {
          rating,
          comment,
          images: imageUrls,
        },
      );

      return res.status(200).send({
        success: true,
        message: 'Review updated successfully and pending re-approval',
        data: updated,
      });
    } catch (err: any) {
      return res.status(err.status || 500).send({
        success: false,
        error: { message: err?.message ?? 'Internal server error' },
      });
    }
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async deleteReview(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    try {
      const user = (req as any).user;
      await this.reviewsService.deleteCustomerReview(user.id, id);
      return res.status(200).send({
        success: true,
        message: 'Review deleted successfully',
      });
    } catch (err: any) {
      return res.status(err.status || 500).send({
        success: false,
        error: { message: err?.message ?? 'Internal server error' },
      });
    }
  }

  @Get('product/:productId')
  async getProductReviews(
    @Param('productId') productId: string,
    @Query('page') page: string,
  ) {
    const data = await this.reviewsService.getProductReviews(
      productId,
      parseInt(page) || 1,
    );
    return { success: true, data };
  }

  @Get('product/:productId/stats')
  async getProductReviewStats(@Param('productId') productId: string) {
    const data = await this.reviewsService.getProductReviewStats(productId);
    return { success: true, data };
  }
}
