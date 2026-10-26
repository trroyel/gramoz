import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('admin/reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
export class ReviewsAdminController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  async getAllReviews(@Query('page') page: string) {
    const data = await this.reviewsService.getAllForAdmin(parseInt(page) || 1);
    return { success: true, data };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: 'pending' | 'approved' | 'rejected',
  ) {
    if (!isUUID(id)) {
      throw new BadRequestException('Invalid review ID format');
    }
    const data = await this.reviewsService.updateReviewStatus(id, status);
    return { success: true, message: 'Review status updated', data };
  }

  @Delete(':id')
  async deleteReview(@Param('id') id: string) {
    if (!isUUID(id)) {
      throw new BadRequestException('Invalid review ID format');
    }
    await this.reviewsService.deleteReview(id);
    return { success: true, message: 'Review deleted successfully' };
  }
}
