import { Controller, Get, Put, Post, Body, UseGuards, UseInterceptors, Req, Res } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SettingsService } from './settings.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FastifyFileUploadInterceptor } from '../../common/interceptors/fastify-file-upload.interceptor';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  async getAllSettings() {
    const data = await this.settingsService.getAllSettings();
    return { success: true, data };
  }

  @Put()
  async updateSetting(
    @Body() body: { key: string; value: string; description?: string },
  ) {
    await this.settingsService.setSetting(
      body.key,
      body.value,
      body.description,
    );
    return { success: true, message: 'Setting updated successfully' };
  }

  @Put('storefront')
  async updateStorefront(@Body() body: { hero?: any; promo?: any }) {
    await this.settingsService.updateStorefrontConfig(body);
    return { success: true, message: 'Storefront updated successfully' };
  }

  @Post('upload-image')
  @UseInterceptors(FastifyFileUploadInterceptor)
  async uploadImage(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    try {
      const uploadedFile = (req as any).uploadedFile;
      if (!uploadedFile) {
        return res.status(400).send({ success: false, message: 'No file uploaded' });
      }

      const imageUrl = await this.storageService.upload(
        uploadedFile.file,
        uploadedFile.filename,
        uploadedFile.mimetype,
      );

      return res.send({ success: true, url: imageUrl });
    } catch (err: any) {
      return res.status(500).send({ success: false, error: err.message });
    }
  }
}
