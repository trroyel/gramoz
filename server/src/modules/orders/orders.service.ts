import {
  Injectable,
} from '@nestjs/common';
import { EntityNotFoundError, InvalidOperationError, InsufficientStockError } from '../../common/errors/domain.errors';
import * as schema from '@database/schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { PromosService } from '../promos/promos.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { CourierService } from '../courier/courier.service';
import { OrdersStore } from './orders.store';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersStore: OrdersStore,
    private readonly promosService: PromosService,
    private readonly loyaltyService: LoyaltyService,
    private readonly settingsService: SettingsService,
    private readonly courierService: CourierService,
  ) {}

  async createOrderFromCart(userId: string, dto: CreateOrderDto): Promise<schema.Order> {
    const cartItems = await this.ordersStore.getCartItemsWithProducts(userId);

    if (cartItems.length === 0) {
      throw new InvalidOperationError('Your cart is empty');
    }

    for (const item of cartItems) {
      const stock = (item as any).variantId ? ((item as any).variantStock ?? 0) : (item.productStock ?? 0);
      if (stock < item.quantity) {
        throw new InsufficientStockError(
          `Insufficient stock for "${item.productName}". Available: ${stock}`,
        );
      }
    }

    let totalAmount =
      cartItems.reduce((sum, item) => {
        const priceStr = (item as any).variantPrice ?? item.productPrice ?? '0';
        const priceInCents = Math.round(
          parseFloat(priceStr) * 100,
        );
        return sum + priceInCents * item.quantity;
      }, 0) / 100;

    let appliedPromoId: string | null = null;
    let discountAmount = 0;

    if (dto.promoCode) {
      const promoResult = await this.promosService.validate({
        code: dto.promoCode,
        subtotal: totalAmount,
      });
      appliedPromoId = promoResult.promoId;
      discountAmount += promoResult.discountAmount;
      totalAmount -= promoResult.discountAmount;
    }

    let pointsSpent = 0;
    if (dto.usePoints) {
      const balance = await this.loyaltyService.getBalance(userId);
      const ratio = await this.settingsService.getPointsToCurrencyRatio();
      
      // Calculate how many points we can use to cover the remaining totalAmount
      // Or just spend all available points to reduce the price
      const maxPointsValue = balance / ratio;
      
      let pointsToUse = 0;
      let pointsValue = 0;
      
      if (maxPointsValue >= totalAmount) {
        // Points cover the whole cost
        pointsValue = totalAmount;
        pointsToUse = Math.ceil(totalAmount * ratio);
      } else {
        // Spend all points
        pointsValue = maxPointsValue;
        pointsToUse = balance;
      }
      
      if (pointsToUse > 0) {
        pointsSpent = pointsToUse;
        discountAmount += pointsValue;
        totalAmount -= pointsValue;
      }
    }

    const result = await this.ordersStore.runTransaction(async (tx) => {
      const existingAddress = await this.ordersStore.findAddress(userId, dto.addressLine1, dto.city, tx);

      let address: schema.Address;
      if (existingAddress) {
        // Backfill zoneId if it was missing (old address saved before this feature)
        if (dto.zoneId && !existingAddress.zoneId) {
          address = await this.ordersStore.updateAddressZone(existingAddress.id, dto.zoneId, tx);
        } else {
          address = existingAddress;
        }
      } else {
        address = await this.ordersStore.createAddress(
          {
            userId,
            title: 'Shipping Address',
            addressLine1: dto.addressLine1,
            city: dto.city,
            latitude: dto.latitude,
            longitude: dto.longitude,
            zoneId: dto.zoneId,
            isDefault: false,
          },
          tx,
        );
      }


      // Calculate delivery charge if zone and method are provided
      let deliveryCharge = 0;
      if (dto.zoneId && dto.deliveryMethod) {
        // Calculate approximate weight from cart (default 0.5 for now, could be dynamic)
        const totalWeight = cartItems.length * 0.5;
        const calc = await this.courierService.calculateCharge(dto.zoneId, dto.deliveryMethod, totalWeight);
        deliveryCharge = calc.charge;
      }
      
      const order = await this.ordersStore.createOrder(
        {
          userId,
          shippingAddressId: address.id,
          totalAmount: (totalAmount + deliveryCharge).toFixed(2),
          deliveryCharge: deliveryCharge.toFixed(2),
          deliveryMethod: dto.deliveryMethod || 'home',
          status: 'pending',
          promoId: appliedPromoId,
          discountAmount: discountAmount.toString(),
        },
        tx,
      );

      for (const item of cartItems) {
        await this.ordersStore.createOrderItem(
          {
            orderId: order.id,
            productId: item.productId,
            variantId: (item as any).variantId,
            variantAttributes: (item as any).variantAttributes,
            quantity: item.quantity,
            unitPrice: (item as any).variantPrice ?? item.productPrice ?? '0',
          },
          tx,
        );

        let stockUpdated = false;
        if ((item as any).variantId) {
          stockUpdated = await this.ordersStore.deductVariantStock((item as any).variantId, item.quantity, tx);
        } else {
          stockUpdated = await this.ordersStore.deductProductStock(item.productId!, item.quantity, tx);
        }

        if (!stockUpdated) {
          throw new InsufficientStockError(
            `"${item.productName}" just sold out. Please remove it from your cart.`,
          );
        }

        await this.ordersStore.createInventoryTransaction(
          {
            productId: item.productId,
            type: 'out',
            quantity: item.quantity,
            referenceId: order.id,
            notes: `Order placed`,
          },
          tx,
        );
      }

      await this.ordersStore.deleteCartItemsByUserId(userId, tx);

      if (appliedPromoId) {
        const updatedPromo = await this.ordersStore.incrementPromoUsage(appliedPromoId, tx);

        if (!updatedPromo) {
          throw new InvalidOperationError(
            'This promo code just reached its usage limit. Please try without a promo code.',
          );
        }
      }

      const user = await this.ordersStore.getUserBasicInfo(userId, tx);

      if (user) {
        const emailItems = cartItems.map((i) => ({
          productName: i.productName ?? 'Product',
          quantity: i.quantity,
          unitPrice: i.productPrice ?? '0',
        }));
        await this.ordersStore.createOutboxEvent(
          {
            type: 'SEND_ORDER_CONFIRMATION',
            payload: {
              email: user.email,
              fullName: user.fullName,
              orderId: order.id,
              items: emailItems,
              totalAmount: order.totalAmount,
            },
          },
          tx,
        );
      }

      if (pointsSpent > 0) {
        await this.loyaltyService.spendPoints(
          userId,
          pointsSpent,
          order.id,
          tx,
        );
      }

      await this.ordersStore.createOutboxEvent(
        {
          type: 'SEND_LOW_STOCK_ALERT',
          payload: { productIds: cartItems.map((i) => i.productId!) },
        },
        tx,
      );

      return { order, items: cartItems, user };
    });

    return result.order;
  }

  async getUserOrders(userId: string, page = 1, limit = 10): Promise<any[]> {
    const offset = (Math.max(1, page) - 1) * Math.min(50, limit);
    const ordersWithPayments = await this.ordersStore.getUserOrdersWithPayments(userId, limit, offset);

    return ordersWithPayments.map((order) => ({
      ...order,
      payment: order.payments[0] || null,
      payments: undefined,
    }));
  }

  async getOrderDetails(userId: string, orderId: string): Promise<any> {
    const order = await this.ordersStore.getOrderDetailsWithPayments(userId, orderId);

    if (!order) {
      throw new EntityNotFoundError('Order not found');
    }

    const items = await this.ordersStore.getOrderItemsWithProducts(orderId);

    const { payments, ...orderData } = order;
    return { ...orderData, payment: payments[0] || null, items };
  }

  async getOrderDetailsAsAdmin(orderId: string): Promise<any> {
    const order = await this.ordersStore.getOrderDetailsAsAdmin(orderId);

    if (!order) {
      throw new EntityNotFoundError('Order not found');
    }

    const items = await this.ordersStore.getOrderItemsWithProducts(orderId);
    const payment = await this.ordersStore.getLatestPaymentByOrderId(orderId);

    return { ...order, items, payment };
  }

  async getAllOrdersAsAdmin(page = 1, limit = 20): Promise<any[]> {
    const offset = (Math.max(1, page) - 1) * Math.min(100, limit);
    const ordersWithRelations = await this.ordersStore.getAllOrdersWithRelationsAsAdmin(limit, offset);

    return ordersWithRelations.map((order) => {
      const { user, payments, ...orderData } = order;
      return {
        ...orderData,
        customerName: user?.fullName,
        payment: payments[0] || null,
      };
    });
  }

  async updateOrderStatus(id: string, status: string): Promise<schema.Order> {
    const validStatuses = [
      'pending',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
    ];
    if (!validStatuses.includes(status)) {
      throw new InvalidOperationError(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      );
    }

    const updated = await this.ordersStore.runTransaction(async (tx) => {
      const order = await this.ordersStore.updateOrderStatus(id, status, tx);

      if (!order) {
        throw new EntityNotFoundError('Order not found');
      }

      if (status === 'shipped') {
        await this.ordersStore.createOutboxEvent(
          {
            type: 'CREATE_CONSIGNMENT',
            payload: { orderId: id },
            status: 'pending',
          },
          tx,
        );
      } else if (status === 'delivered') {
        const user = await this.ordersStore.getUserBasicInfo(order.userId, tx);
        if (user?.phone) {
          await this.ordersStore.createOutboxEvent(
            {
              type: 'SEND_SMS',
              payload: {
                type: 'delivered',
                phone: user.phone,
                orderId: id,
              },
            },
            tx,
          );
        }
      }

      return order;
    });

    return updated;
  }
}
