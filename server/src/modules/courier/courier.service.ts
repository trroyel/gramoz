import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { eq, sql } from 'drizzle-orm';
import {
  EntityNotFoundError,
  EntityConflictError,
  InvalidOperationError,
} from '../../common/errors/domain.errors';
import { ResolveCourierReconciliationDto } from './dto/reconcile-courier.dto';

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
  /** Outcome unknown: the provider may or may not have processed the request. */
  ambiguous?: boolean;
  /** Shipment is known to exist at the provider but no linkable id was returned. */
  exists?: boolean;
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
  constructor(
    private readonly configService: ConfigService,
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  private readonly baseUrl = 'https://portal.steadfast.com.bd/api/v1';

  private async getCredentials() {
    const keys = await this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'COURIER_SETTINGS'));
    let settings = { mode: 'mock', apiKey: '', secretKey: '' };
    if (keys.length > 0 && keys[0].value) {
      try {
        settings = JSON.parse(keys[0].value);
      } catch {
        // ignore parse error
      }
    }

    // Fallback to .env if DB is empty but .env has it (for legacy support)
    if (!settings.apiKey && !settings.secretKey) {
      settings.apiKey = this.configService.get<string>('STEADFAST_API_KEY', '');
      settings.secretKey = this.configService.get<string>(
        'STEADFAST_SECRET_KEY',
        '',
      );
    }

    return settings;
  }

  async createConsignment(
    request: ConsignmentRequest,
  ): Promise<ConsignmentResponse> {
    const creds = await this.getCredentials();

    // If credentials are not configured or mode is mock, fall back to mock so local dev still works
    if (creds.mode === 'mock' || !creds.apiKey || !creds.secretKey) {
      this.logger.warn(
        'Courier is in mock mode or API keys not set — using mock response',
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
          'Api-Key': creds.apiKey,
          'Secret-Key': creds.secretKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      // 5xx / 408 / 429: the request may have been processed before the failure.
      if (response.status >= 500 || response.status === 408) {
        this.logger.error(
          `Steadfast create_order returned HTTP ${response.status} for order ${request.orderId} — outcome ambiguous`,
        );
        return {
          success: false,
          ambiguous: true,
          message: `Courier API returned HTTP ${response.status}`,
        };
      }

      let data: any;
      try {
        data = await response.json();
      } catch {
        return {
          success: false,
          ambiguous: true,
          message: 'Courier API returned an unparseable response',
        };
      }

      if (response.ok && data.status === 200) {
        // Documented shape: { status, message, consignment: { consignment_id, tracking_code } }.
        // `data.data` is tolerated for backward compatibility.
        const info = data.consignment ?? data.data ?? {};
        const trackingCode: string = info.tracking_code
          ? String(info.tracking_code)
          : '';
        if (!trackingCode) {
          // Provider accepted the request but returned nothing we can link: the shipment
          // exists. Treat as ambiguous so we never blindly create a second one.
          this.logger.error(
            `Steadfast accepted order ${request.orderId} but returned no tracking_code`,
          );
          return {
            success: false,
            ambiguous: true,
            message: 'Courier accepted the request without a tracking code',
          };
        }
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

      // Definitive provider rejection (HTTP 4xx / non-200 status in a parsed body).
      this.logger.error('Steadfast API error:', data);
      return {
        success: false,
        message: data.message ?? 'Failed to create consignment',
      };
    } catch (error) {
      // Timeout / network failure: the request may have reached Steadfast.
      this.logger.error('Steadfast API request failed:', error);
      return {
        success: false,
        ambiguous: true,
        message: 'Courier API unreachable',
      };
    }
  }

  /**
   * Inquires Steadfast API for an existing consignment by merchant invoice (orderId).
   * Used for idempotency recovery when a previous worker crashed after calling
   * createConsignment but before saving the consignmentId to PostgreSQL.
   */
  async getConsignmentByInvoice(
    invoice: string,
  ): Promise<ConsignmentResponse | null> {
    const creds = await this.getCredentials();

    if (creds.mode === 'mock' || !creds.apiKey || !creds.secretKey) {
      return null;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/status_by_invoice/${encodeURIComponent(invoice)}`,
        {
          headers: {
            'Api-Key': creds.apiKey,
            'Secret-Key': creds.secretKey,
          },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        return {
          success: false,
          ambiguous: true,
          message: `Steadfast status inquiry returned HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      if (data.status === 200 && (data.delivery_status || data.data)) {
        // Documented response is `{ status: 200, delivery_status }` — it confirms the
        // shipment EXISTS but carries no tracking code. Existence must never be reported
        // as "not found".
        const info =
          data.data && typeof data.data === 'object' ? data.data : undefined;
        const trackingCode =
          info?.tracking_code ||
          (typeof data.delivery_status === 'object'
            ? data.delivery_status?.tracking_code
            : undefined) ||
          '';
        if (!trackingCode) {
          return {
            success: false,
            exists: true,
            message: `Shipment exists at provider (delivery_status=${typeof data.delivery_status === 'string' ? data.delivery_status : 'unknown'}) but no tracking code was returned`,
          };
        }
        return {
          success: true,
          consignmentId: String(trackingCode),
          trackingCode: String(trackingCode),
          trackingUrl: `https://steadfast.com.bd/t/${trackingCode}`,
          message: data.message ?? 'Consignment found',
        };
      }

      if (data.status === 404) {
        return null;
      }

      return null;
    } catch (error) {
      this.logger.warn(
        `Steadfast status_by_invoice lookup failed for ${invoice}:`,
        error,
      );
      return {
        success: false,
        ambiguous: true,
        message:
          error instanceof Error ? error.message : 'Courier API unreachable',
      };
    }
  }

  async trackConsignment(trackingCode: string): Promise<any> {
    if (!trackingCode || trackingCode === 'PENDING_DISPATCH') {
      return {
        success: false,
        message:
          'Consignment is pending dispatch and tracking is not yet available.',
      };
    }

    // Attempt to pull real coordinates from DB if order exists
    let realDestination = null;
    let realCurrent = null;
    let orderRecord = null;
    try {
      this.logger.log(`Looking up order with consignmentId: ${trackingCode}`);
      orderRecord = await this.db.query.orders.findFirst({
        where: eq(schema.orders.consignmentId, trackingCode),
        with: {
          shippingAddress: true,
        },
      });
      this.logger.log(
        `Order record found: ${!!orderRecord}, status: ${orderRecord?.status}`,
      );

      if (
        orderRecord &&
        orderRecord.shippingAddress &&
        orderRecord.shippingAddress.latitude &&
        orderRecord.shippingAddress.longitude
      ) {
        const destLat = parseFloat(
          orderRecord.shippingAddress.latitude as unknown as string,
        );
        const destLng = parseFloat(
          orderRecord.shippingAddress.longitude as unknown as string,
        );
        realDestination = [destLat, destLng];
        // Calculate a mid-point for the truck's mock current location
        realCurrent = [(24.363 + destLat) / 2, (88.835 + destLng) / 2];
      }
    } catch (err) {
      this.logger.warn(
        `Failed to pull DB coordinates for tracking code ${trackingCode}: ${err.message}`,
      );
    }

    const creds = await this.getCredentials();

    if (creds.mode === 'mock' || !creds.apiKey || !creds.secretKey) {
      const realStatus = orderRecord ? orderRecord.status : 'shipped';

      const isOutForDelivery =
        realStatus === 'out_for_delivery' || realStatus === 'delivered';
      const isDelivered = realStatus === 'delivered';

      let displayStatus = 'In Transit';
      if (isDelivered) displayStatus = 'Delivered';
      else if (isOutForDelivery) displayStatus = 'Out for Delivery';

      return {
        success: true,
        trackingCode,
        isMock: true,
        currentStatus: displayStatus,
        origin: [24.363, 88.835], // Puthia, Rajshahi
        destination: realDestination || [23.7925, 90.4078], // Use real DB coords if found, else Dhaka
        currentLocation: isDelivered
          ? realDestination || [23.7925, 90.4078]
          : realCurrent || [24.25, 89.91],

        timeline: [
          {
            status: 'Order Placed',
            description: 'Your order was successfully placed.',
            time: new Date(Date.now() - 86400000 * 2).toISOString(),
            completed: true,
          },
          {
            status: 'Picked Up by Courier',
            description:
              'The package has been picked up from our warehouse in Puthia, Rajshahi.',
            time: new Date(Date.now() - 86400000).toISOString(),
            completed: true,
          },
          {
            status: 'In Transit',
            description: 'The package is on its way to your city.',
            time: new Date(Date.now() - 43200000).toISOString(),
            completed: true,
          },
          {
            status: 'Out for Delivery',
            description: 'The package is out for delivery.',
            time: isOutForDelivery
              ? new Date(Date.now() - 3600000).toISOString()
              : null,
            completed: isOutForDelivery,
          },
          {
            status: 'Delivered',
            description: 'The package has been delivered.',
            time: isDelivered ? new Date().toISOString() : null,
            completed: isDelivered,
          },
        ],
      };
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/status_by_invoice/${encodeURIComponent(trackingCode)}`,
        {
          headers: {
            'Api-Key': creds.apiKey,
            'Secret-Key': creds.secretKey,
          },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) {
        return { success: false, message: 'Failed to fetch tracking data' };
      }

      const data = await response.json();
      return { success: true, ...data };
    } catch {
      return { success: false, message: 'Courier API unreachable' };
    }
  }

  /** Used for local dev when credentials are not configured */
  private mockConsignment(_request: ConsignmentRequest): ConsignmentResponse {
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
    const allDivisions = await this.db
      .select()
      .from(schema.divisions)
      .where(eq(schema.divisions.isActive, true));
    const allDistricts = await this.db
      .select()
      .from(schema.districts)
      .where(eq(schema.districts.isActive, true));
    const allZones = await this.db
      .select()
      .from(schema.zones)
      .where(eq(schema.zones.isActive, true));

    return {
      divisions: allDivisions,
      districts: allDistricts,
      zones: allZones,
    };
  }

  async calculateCharge(
    zoneId: string,
    deliveryMethod: 'home' | 'branch',
    weightKg: number = 0.5,
  ) {
    const [zone] = await this.db
      .select()
      .from(schema.zones)
      .where(eq(schema.zones.id, zoneId));
    if (!zone) throw new Error('Zone not found');

    const method = deliveryMethod === 'branch' ? 'branch' : 'home';
    let charge = parseFloat(
      method === 'branch' ? zone.branchPickupCharge : zone.homeDeliveryCharge,
    );

    const safeWeight =
      typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg >= 0
        ? weightKg
        : 0.5;

    // Add extra weight logic if weight > 1kg
    if (safeWeight > 1) {
      const extraWeight = Math.ceil(safeWeight - 1);
      charge += extraWeight * 15; // 15 BDT per extra KG
    }

    return {
      charge,
      estimatedDays: zone.estimatedDays,
    };
  }

  /**
   * Find unresolved courier outbox dispatches requiring manual or administrative attention.
   */
  async getUnresolvedReconciliations(page: number = 1, limit: number = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(100, limit));
    const offset = (safePage - 1) * safeLimit;

    const condition = sql`${schema.outboxEvents.type} = 'CREATE_CONSIGNMENT' 
      AND (${schema.outboxEvents.status} = 'failed' 
        OR ${schema.outboxEvents.lastError} LIKE '%RECONCILIATION_REQUIRED%'
        OR (${schema.outboxEvents.status} = 'processing' AND ${schema.outboxEvents.updatedAt} < NOW() - INTERVAL '5 minutes'))`;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.outboxEvents)
      .where(condition);

    const total = countResult?.count ?? 0;

    const events = await this.db
      .select()
      .from(schema.outboxEvents)
      .where(condition)
      .orderBy(sql`${schema.outboxEvents.updatedAt} DESC`)
      .limit(safeLimit)
      .offset(offset);

    // Enrich with order, address, and user metadata
    const items = await Promise.all(
      events.map(async (event) => {
        const orderId = (event.payload as { orderId?: string })?.orderId;
        let order = null;
        let user = null;
        let address = null;

        if (orderId) {
          const [o] = await this.db
            .select()
            .from(schema.orders)
            .where(eq(schema.orders.id, orderId));
          order = o ?? null;

          if (order?.userId) {
            const [u] = await this.db
              .select({
                id: schema.users.id,
                email: schema.users.email,
                fullName: schema.users.fullName,
                phone: schema.users.phone,
              })
              .from(schema.users)
              .where(eq(schema.users.id, order.userId));
            user = u ?? null;
          }

          if (order?.shippingAddressId) {
            const [a] = await this.db
              .select()
              .from(schema.addresses)
              .where(eq(schema.addresses.id, order.shippingAddressId));
            address = a ?? null;
          }
        }

        return {
          eventId: event.id,
          type: event.type,
          status: event.status,
          attempts: event.attempts,
          lastError: event.lastError,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
          orderId,
          order: order
            ? {
                id: order.id,
                status: order.status,
                paymentStatus: order.paymentStatus,
                totalAmount: order.totalAmount,
                consignmentId: order.consignmentId,
                createdAt: order.createdAt,
              }
            : null,
          user,
          address,
        };
      }),
    );

    return {
      items,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * View details of a specific courier reconciliation item including live provider lookup.
   */
  async getReconciliationDetail(eventId: string) {
    const [event] = await this.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.id, eventId));

    if (!event) {
      throw new EntityNotFoundError(`Outbox event ${eventId} not found`);
    }

    if (event.type !== 'CREATE_CONSIGNMENT') {
      throw new InvalidOperationError(
        `Event ${eventId} is not a courier consignment dispatch`,
      );
    }

    const orderId = (event.payload as { orderId?: string })?.orderId;
    if (!orderId) {
      throw new InvalidOperationError(
        `Event ${eventId} has no associated orderId`,
      );
    }

    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    if (!order) {
      throw new EntityNotFoundError(`Order ${orderId} not found`);
    }

    let user = null;
    if (order.userId) {
      const [u] = await this.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          fullName: schema.users.fullName,
          phone: schema.users.phone,
        })
        .from(schema.users)
        .where(eq(schema.users.id, order.userId));
      user = u ?? null;
    }

    let address = null;
    if (order.shippingAddressId) {
      const [a] = await this.db
        .select()
        .from(schema.addresses)
        .where(eq(schema.addresses.id, order.shippingAddressId));
      address = a ?? null;
    }

    // Live provider verification (Steadfast status inquiry)
    let providerStatus = null;
    try {
      providerStatus = await this.getConsignmentByInvoice(orderId);
    } catch (err: unknown) {
      providerStatus = {
        success: false,
        ambiguous: true,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      event,
      order,
      user,
      address,
      providerStatus,
    };
  }

  /**
   * Authoritative manual courier reconciliation executed by an administrator.
   * Concurrency-safe: utilizes row locks on outbox_events and orders inside a transaction.
   */
  async reconcileCourierDispatch(
    admin: { id: string; email: string },
    eventId: string,
    dto: ResolveCourierReconciliationDto,
  ) {
    return await this.db.transaction(async (tx) => {
      // 1. Lock outbox event row with FOR UPDATE
      const [event] = await tx
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, eventId))
        .for('update');

      if (!event) {
        throw new EntityNotFoundError(`Outbox event ${eventId} not found`);
      }

      if (event.type !== 'CREATE_CONSIGNMENT') {
        throw new InvalidOperationError(
          `Event ${eventId} is not a courier consignment dispatch`,
        );
      }

      if (event.status === 'completed') {
        throw new EntityConflictError(
          `Outbox event ${eventId} has already been reconciled or completed`,
        );
      }

      const orderId = (event.payload as { orderId?: string })?.orderId;
      if (!orderId) {
        throw new InvalidOperationError(
          `Outbox event ${eventId} missing orderId in payload`,
        );
      }

      // 2. Lock order row with FOR UPDATE
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .for('update');

      if (!order) {
        throw new EntityNotFoundError(`Order ${orderId} not found`);
      }

      const timestamp = new Date().toISOString();

      if (dto.action === 'ADOPT_CONSIGNMENT') {
        const consignmentId = dto.consignmentId?.trim();
        if (!consignmentId) {
          throw new InvalidOperationError(
            'consignmentId is required when action is ADOPT_CONSIGNMENT',
          );
        }

        const previousState = {
          outboxStatus: event.status,
          outboxAttempts: event.attempts,
          orderStatus: order.status,
          orderConsignmentId: order.consignmentId,
        };

        const newOrderStatus =
          order.status === 'processing' ? 'shipped' : order.status;

        // Update order with verified consignment ID
        await tx
          .update(schema.orders)
          .set({
            consignmentId,
            status: newOrderStatus,
            updatedAt: new Date(),
          })
          .where(eq(schema.orders.id, orderId));

        const auditTrail = `[RECONCILED by admin ${admin.id} (${admin.email}) at ${timestamp}]: Action=ADOPT_CONSIGNMENT, ConsignmentId=${consignmentId}. Notes: ${dto.notes}`;

        await tx
          .update(schema.outboxEvents)
          .set({
            status: 'completed',
            lastError: auditTrail,
            updatedAt: new Date(),
          })
          .where(eq(schema.outboxEvents.id, eventId));

        const newState = {
          outboxStatus: 'completed',
          outboxAttempts: event.attempts,
          orderStatus: newOrderStatus,
          orderConsignmentId: consignmentId,
        };

        // Permanent, append-only immutable audit record (TASK-27F)
        await tx.insert(schema.courierReconciliationAudit).values({
          eventId,
          orderId,
          adminId: admin.id,
          adminEmail: admin.email,
          action: 'ADOPT_CONSIGNMENT',
          reason: dto.notes,
          evidenceRef: dto.evidenceRef ?? consignmentId,
          previousState,
          newState,
        });

        return {
          success: true,
          action: 'ADOPT_CONSIGNMENT',
          orderId,
          consignmentId,
          auditTrail,
        };
      } else if (dto.action === 'CLEAR_AND_RETRY') {
        // If order already has a genuine assigned consignment, cannot clear
        if (order.consignmentId && order.consignmentId !== 'PENDING_DISPATCH') {
          throw new EntityConflictError(
            `Cannot clear consignment for order ${orderId} which already has an active consignment (${order.consignmentId})`,
          );
        }

        // TASK-27F Invariant: Positive evidence and explicit confirmation required for re-dispatch
        // A provider 404 alone is ambiguous and cannot trigger re-dispatch without confirmation
        if (
          !dto.confirmCarrierRejection ||
          !dto.evidenceRef ||
          dto.evidenceRef.trim().length < 5
        ) {
          throw new InvalidOperationError(
            'CLEAR_AND_RETRY requires positive carrier rejection evidence (evidenceRef >= 5 chars) and confirmCarrierRejection=true. A provider 404 alone is ambiguous and cannot trigger re-dispatch without positive confirmation.',
          );
        }

        const previousState = {
          outboxStatus: event.status,
          outboxAttempts: event.attempts,
          orderStatus: order.status,
          orderConsignmentId: order.consignmentId,
        };

        // Reset order sentinel
        await tx
          .update(schema.orders)
          .set({
            consignmentId: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.orders.id, orderId));

        // Re-queue outbox event to pending with attempts = 0
        const auditTrail = `[RECONCILED by admin ${admin.id} (${admin.email}) at ${timestamp}]: Action=CLEAR_AND_RETRY, EvidenceRef=${dto.evidenceRef}. Cleared dispatch sentinel for re-dispatch. Notes: ${dto.notes}`;

        await tx
          .update(schema.outboxEvents)
          .set({
            status: 'pending',
            attempts: 0,
            lastError: auditTrail,
            updatedAt: new Date(),
          })
          .where(eq(schema.outboxEvents.id, eventId));

        const newState = {
          outboxStatus: 'pending',
          outboxAttempts: 0,
          orderStatus: order.status,
          orderConsignmentId: null,
        };

        // Permanent, append-only immutable audit record (TASK-27F)
        await tx.insert(schema.courierReconciliationAudit).values({
          eventId,
          orderId,
          adminId: admin.id,
          adminEmail: admin.email,
          action: 'CLEAR_AND_RETRY',
          reason: dto.notes,
          evidenceRef: dto.evidenceRef,
          previousState,
          newState,
        });

        return {
          success: true,
          action: 'CLEAR_AND_RETRY',
          orderId,
          consignmentId: null,
          evidenceRef: dto.evidenceRef,
          auditTrail,
        };
      } else if (dto.action === 'CANCEL_DISPATCH') {
        const previousState = {
          outboxStatus: event.status,
          outboxAttempts: event.attempts,
          orderStatus: order.status,
          orderConsignmentId: order.consignmentId,
        };

        // Clear sentinel if pending dispatch
        if (order.consignmentId === 'PENDING_DISPATCH') {
          await tx
            .update(schema.orders)
            .set({
              consignmentId: null,
              updatedAt: new Date(),
            })
            .where(eq(schema.orders.id, orderId));
        }

        const auditTrail = `[RECONCILED by admin ${admin.id} (${admin.email}) at ${timestamp}]: Action=CANCEL_DISPATCH. Dispatch cancelled. Notes: ${dto.notes}`;

        await tx
          .update(schema.outboxEvents)
          .set({
            status: 'completed',
            lastError: auditTrail,
            updatedAt: new Date(),
          })
          .where(eq(schema.outboxEvents.id, eventId));

        const newState = {
          outboxStatus: 'completed',
          outboxAttempts: event.attempts,
          orderStatus: order.status,
          orderConsignmentId:
            order.consignmentId === 'PENDING_DISPATCH'
              ? null
              : order.consignmentId,
        };

        // Permanent, append-only immutable audit record (TASK-27F)
        await tx.insert(schema.courierReconciliationAudit).values({
          eventId,
          orderId,
          adminId: admin.id,
          adminEmail: admin.email,
          action: 'CANCEL_DISPATCH',
          reason: dto.notes,
          evidenceRef: dto.evidenceRef ?? null,
          previousState,
          newState,
        });

        return {
          success: true,
          action: 'CANCEL_DISPATCH',
          orderId,
          auditTrail,
        };
      } else {
        throw new InvalidOperationError(
          `Unknown reconciliation action: ${(dto as any).action}`,
        );
      }
    });
  }

  /**
   * Fetch complete, immutable audit trail for a reconciled outbox event.
   */
  async getReconciliationAuditHistory(eventId: string) {
    return await this.db
      .select()
      .from(schema.courierReconciliationAudit)
      .where(eq(schema.courierReconciliationAudit.eventId, eventId))
      .orderBy(sql`${schema.courierReconciliationAudit.createdAt} DESC`);
  }
}
