import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  constructor(private readonly configService: ConfigService) {
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
    if (!this.apiKey || !this.secretKey) {
      return { status: 'mock', trackingCode };
    }

    const response = await fetch(
      `${this.baseUrl}/status_by_invoice/${trackingCode}`,
      {
        headers: {
          'Api-Key': this.apiKey,
          'Secret-Key': this.secretKey,
        },
      },
    );
    return response.json();
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
}
