import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { eq } from 'drizzle-orm';

export interface ConsignmentRequest {
  orderId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientCity: string;
  amountToCollect: number;
  itemQuantity: number;
  itemWeight: number;
}

export interface ConsignmentResponse {
  success: boolean;
  consignmentId?: string;
  trackingCode?: string;
  trackingUrl?: string;
  message?: string;
}

/**
 * Steadfast Courier Integration
 * Docs: https://steadfast.com.bd/user/api-integration
 *
 * To get credentials:
 *   1. Register at https://steadfast.com.bd
 *   2. Log into your merchant panel
 *   3. Go to Profile → API Credentials
 *   4. Copy API Key and Secret Key into your .env file
 */
@Injectable()
export class CourierService {
  private readonly logger = new Logger(CourierService.name);
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl = 'https://portal.steadfast.com.bd/api/v1';

  constructor(
    private readonly configService: ConfigService,
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {
    this.apiKey = this.configService.get<string>('STEADFAST_API_KEY', '');
    this.secretKey = this.configService.get<string>('STEADFAST_SECRET_KEY', '');
  }

  async createConsignment(
    request: ConsignmentRequest,
  ): Promise<ConsignmentResponse> {
    // If credentials are not configured, fall back to mock so local dev still works
    if (!this.apiKey || !this.secretKey) {
      this.logger.warn(
        'STEADFAST_API_KEY / STEADFAST_SECRET_KEY not set — using mock response',
      );
      return this.mockConsignment(request);
    }

    const payload = {
      invoice: request.orderId,
      recipient_name: request.recipientName,
      recipient_phone: request.recipientPhone,
      recipient_address: request.recipientAddress,
      cod_amount: request.amountToCollect,
      note: `Gramoz Order — ${request.itemQuantity} item(s)`,
    };

    try {
      const response = await fetch(`${this.baseUrl}/create_order`, {
        method: 'POST',
        headers: {
          'Api-Key': this.apiKey,
          'Secret-Key': this.secretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok && data.status === 200) {
        const trackingCode: string = data.data?.tracking_code ?? '';
        this.logger.log(
          `Steadfast consignment created: ${trackingCode} for order ${request.orderId}`,
        );
        return {
          success: true,
          consignmentId: trackingCode,
          trackingCode,
          trackingUrl: `https://steadfast.com.bd/t/${trackingCode}`,
          message: data.message,
        };
      }

      this.logger.error('Steadfast API error:', data);
      return {
        success: false,
        message: data.message ?? 'Failed to create consignment',
      };
    } catch (error) {
      this.logger.error('Steadfast API request failed:', error);
      return { success: false, message: 'Courier API unreachable' };
    }
  }

  async trackConsignment(trackingCode: string): Promise<any> {
    // Attempt to pull real coordinates from DB if order exists
    let realDestination = null;
    let realCurrent = null;
    try {
      const orderRecord = await this.db.query.orders.findFirst({
        where: eq(schema.orders.consignmentId, trackingCode),
        with: {
          shippingAddress: true
        }
      });
      if (orderRecord && orderRecord.shippingAddress && orderRecord.shippingAddress.latitude && orderRecord.shippingAddress.longitude) {
        const destLat = parseFloat(orderRecord.shippingAddress.latitude);
        const destLng = parseFloat(orderRecord.shippingAddress.longitude);
        realDestination = [destLat, destLng];
        // Calculate a mid-point for the truck's mock current location
        realCurrent = [
          (24.363 + destLat) / 2,
          (88.835 + destLng) / 2
        ];
      }
    } catch (err) {
      this.logger.warn(`Failed to pull DB coordinates for tracking code ${trackingCode}: ${err.message}`);
    }

    if (!this.apiKey || !this.secretKey) {
      return { 
        success: true, 
        trackingCode, 
        isMock: true,
        currentStatus: 'In Transit',
        origin: [24.363, 88.835], // Puthia, Rajshahi
        destination: realDestination || [23.7925, 90.4078], // Use real DB coords if found, else Dhaka
        currentLocation: realCurrent || [24.25, 89.91], // Use mid-point if real coords found, else Tangail

        timeline: [
          { status: 'Order Placed', description: 'Your order was successfully placed.', time: new Date(Date.now() - 86400000 * 2).toISOString(), completed: true },
          { status: 'Picked Up by Courier', description: 'The package has been picked up from our warehouse in Puthia, Rajshahi.', time: new Date(Date.now() - 86400000).toISOString(), completed: true },
          { status: 'In Transit', description: 'The package is on its way to your city.', time: new Date(Date.now() - 43200000).toISOString(), completed: true },
          { status: 'Out for Delivery', description: 'The package is out for delivery.', time: null, completed: false },
          { status: 'Delivered', description: 'The package has been delivered.', time: null, completed: false },
        ] 
      };
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/status_by_invoice/${trackingCode}`,
        {
          headers: {
            'Api-Key': this.apiKey,
            'Secret-Key': this.secretKey,
          },
        },
      );
      
      if (!response.ok) {
        return { success: false, message: 'Failed to fetch tracking data' };
      }
      
      const data = await response.json();
      return { success: true, ...data };
    } catch (error) {
      return { success: false, message: 'Courier API unreachable' };
    }
  }

  /** Used for local dev when credentials are not configured */
  private mockConsignment(request: ConsignmentRequest): ConsignmentResponse {
    const mockCode = `SF-MOCK-${Date.now().toString().slice(-6)}`;
    this.logger.log(`Mock consignment created: ${mockCode}`);
    return {
      success: true,
      consignmentId: mockCode,
      trackingCode: mockCode,
      trackingUrl: `https://steadfast.com.bd/t/${mockCode}`,
      message: 'Mock consignment (no credentials configured)',
    };
  }

  async getRegions() {
    const allDivisions = await this.db.select().from(schema.divisions).where(eq(schema.divisions.isActive, true));
    const allDistricts = await this.db.select().from(schema.districts).where(eq(schema.districts.isActive, true));
    const allZones = await this.db.select().from(schema.zones).where(eq(schema.zones.isActive, true));

    return {
      divisions: allDivisions,
      districts: allDistricts,
      zones: allZones,
    };
  }

  async calculateCharge(zoneId: string, deliveryMethod: 'home' | 'branch', weightKg: number = 0.5) {
    const [zone] = await this.db.select().from(schema.zones).where(eq(schema.zones.id, zoneId));
    if (!zone) throw new Error('Zone not found');

    let charge = parseFloat(deliveryMethod === 'branch' ? zone.branchPickupCharge : zone.homeDeliveryCharge);

    // Add extra weight logic if weight > 1kg
    if (weightKg > 1) {
      const extraWeight = Math.ceil(weightKg - 1);
      charge += extraWeight * 15; // 15 BDT per extra KG
    }

    return {
      charge,
      estimatedDays: zone.estimatedDays,
    };
  }
}
