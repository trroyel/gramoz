import { Controller, Post, Get, Param, Query, UseGuards, Req, Res, UseInterceptors } from '@nestjs/common';
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

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @UseInterceptors(FastifyFileUploadInterceptor)
  async submitReview(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    try {
      const user = (req as any).user;
      const parsedBody = (req as any).parsedBody || {};
      const uploadedFile = (req as any).uploadedFile;

      const orderId = parsedBody.orderId;
      const productId = parsedBody.productId;
      const rating = Number(parsedBody.rating);
      const comment = parsedBody.comment;

      let imageUrls: string[] = [];
      if (uploadedFile) {
        const imageUrl = await this.storageService.upload(
          uploadedFile.file,
          uploadedFile.filename,
          uploadedFile.mimetype,
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

      return res.status(201).send({ success: true, message: 'Review submitted successfully', data: review });
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
    const data = await this.reviewsService.getProductReviews(productId, parseInt(page) || 1);
    return { success: true, data };
  }
}
