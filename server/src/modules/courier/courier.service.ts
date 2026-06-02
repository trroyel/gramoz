import { Injectable, Logger } from '@nestjs/common';

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
  trackingUrl?: string;
  message?: string;
}

@Injectable()
export class CourierService {
  private readonly logger = new Logger(CourierService.name);

  /**
   * Mock Pathao Integration: Create Consignment
   * In a real implementation, this would use the Pathao Sandbox API
   * with proper store/issue tokens.
   */
  async createConsignment(request: ConsignmentRequest): Promise<ConsignmentResponse> {
    this.logger.log(`Mocking Pathao consignment creation for order: ${request.orderId}`);

    // Simulate network latency (500ms)
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Generate mock Pathao response
    const mockConsignmentId = `PATHAO-${Date.now().toString().slice(-6)}-${request.orderId.substring(0, 4)}`;
    const mockTrackingUrl = `https://merchant.pathao.com/tracking?consignment_id=${mockConsignmentId}`;

    this.logger.log(`Successfully created mock consignment: ${mockConsignmentId}`);

    return {
      success: true,
      consignmentId: mockConsignmentId,
      trackingUrl: mockTrackingUrl,
      message: 'Consignment created successfully (Mock)',
    };
  }
}
