import { Controller, Get, Patch, Delete, Param, Query, UseGuards, Body } from '@nestjs/common';
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
    const data = await this.reviewsService.updateReviewStatus(id, status);
    return { success: true, message: 'Review status updated', data };
  }

  @Delete(':id')
  async deleteReview(@Param('id') id: string) {
    await this.reviewsService.deleteReview(id);
    return { success: true, message: 'Review deleted successfully' };
  }
}
