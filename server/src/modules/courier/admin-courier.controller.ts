import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  UseGuards,
  Inject,
  Param,
} from '@nestjs/common';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Roles } from '@modules/auth/decorators/roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { PLATFORM_ROLES } from '@database/schema/enums';
import type { User } from '@database/schema';
import { DATABASE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { eq } from 'drizzle-orm';
import { CourierService } from './courier.service';
import { ResolveCourierReconciliationDto } from './dto/reconcile-courier.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...PLATFORM_ROLES)
@Controller('admin/courier')
export class AdminCourierController {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly courierService: CourierService,
  ) {}

  @Get('settings')
  async getSettings() {
    const keys = await this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'COURIER_SETTINGS'));

    let settings = { mode: 'mock', apiKey: '', secretKey: '' };
    if (keys.length > 0 && keys[0].value) {
      try {
        settings = JSON.parse(keys[0].value);
      } catch (e) {}
    }

    return { success: true, data: settings };
  }

  @Put('settings')
  async updateSettings(
    @Body() body: { mode: string; apiKey: string; secretKey: string },
  ) {
    const value = JSON.stringify({
      mode: body.mode,
      apiKey: body.apiKey,
      secretKey: body.secretKey,
    });

    await this.db
      .insert(schema.settings)
      .values({
        key: 'COURIER_SETTINGS',
        value,
        description: 'Steadfast Courier Integration Settings',
      })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value, updatedAt: new Date() },
      });

    return { success: true, message: 'Courier settings updated' };
  }

  @Get('zones')
  async getZones() {
    const divisions = await this.db.select().from(schema.divisions);
    const districts = await this.db.select().from(schema.districts);
    const zones = await this.db.select().from(schema.zones);
    return { success: true, data: { divisions, districts, zones } };
  }

  @Put('zones/:id')
  async updateZoneCharge(
    @Param('id') id: string,
    @Body() body: { homeDeliveryCharge: string; branchPickupCharge: string },
  ) {
    await this.db
      .update(schema.zones)
      .set({
        homeDeliveryCharge: body.homeDeliveryCharge,
        branchPickupCharge: body.branchPickupCharge,
        updatedAt: new Date(),
      })
      .where(eq(schema.zones.id, id));

    return { success: true, message: 'Zone charges updated' };
  }

  @Get('reconciliations')
  async getReconciliations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const data = await this.courierService.getUnresolvedReconciliations(
      pageNum,
      limitNum,
    );
    return { success: true, ...data };
  }

  @Get('reconciliations/:eventId')
  async getReconciliationDetail(@Param('eventId') eventId: string) {
    const data = await this.courierService.getReconciliationDetail(eventId);
    return { success: true, data };
  }

  @Post('reconciliations/:eventId/resolve')
  async resolveReconciliation(
    @CurrentUser() admin: User,
    @Param('eventId') eventId: string,
    @Body() dto: ResolveCourierReconciliationDto,
  ) {
    const result = await this.courierService.reconcileCourierDispatch(
      { id: admin.id, email: admin.email },
      eventId,
      dto,
    );
    return { success: true, ...result };
  }

  @Get('reconciliations/:eventId/audit')
  async getReconciliationAudit(@Param('eventId') eventId: string) {
    const data =
      await this.courierService.getReconciliationAuditHistory(eventId);
    return { success: true, data };
  }
}
