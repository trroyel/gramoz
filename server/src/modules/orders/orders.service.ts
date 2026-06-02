import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, desc } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { CourierService } from '../courier/courier.service';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly courierService: CourierService,
  ) {}

  async createOrderFromCart(userId: string, dto: CreateOrderDto) {
    // 1. Fetch user's cart
    const cartItems = await this.db
      .select({
        id: schema.cartItems.id,
        productId: schema.cartItems.productId,
        quantity: schema.cartItems.quantity,
        productPrice: schema.products.price,
        productStock: schema.products.stock,
      })
      .from(schema.cartItems)
      .leftJoin(schema.products, eq(schema.cartItems.productId, schema.products.id))
      .where(eq(schema.cartItems.userId, userId));

    if (cartItems.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    // 2. Validate stock for all items
    for (const item of cartItems) {
      if (item.productStock < item.quantity) {
        throw new BadRequestException(`Insufficient stock for product ID: ${item.productId}`);
      }
    }

    // Calculate total amount
    const totalAmount = cartItems.reduce((sum, item) => {
      return sum + parseFloat(item.productPrice ?? '0') * item.quantity;
    }, 0);

    // 3. Perform everything in a database transaction
    return await this.db.transaction(async (tx) => {
      // Create shipping address
      const [address] = await tx
        .insert(schema.addresses)
        .values({
          userId,
          title: 'Default Address',
          addressLine1: dto.addressLine1,
          city: dto.city,
          isDefault: true,
        })
        .returning();

      // Create the order
      const [order] = await tx
        .insert(schema.orders)
        .values({
          userId,
          shippingAddressId: address.id,
          totalAmount: totalAmount.toFixed(2),
          status: 'pending',
        })
        .returning();

      // Create order items, inventory transactions, and update stock
      for (const item of cartItems) {
        // Create order item
        await tx.insert(schema.orderItems).values({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.productPrice ?? '0',
        });

        // Update product stock
        await tx
          .update(schema.products)
          .set({ stock: item.productStock - item.quantity })
          .where(eq(schema.products.id, item.productId));

        // Create inventory transaction (out)
        await tx.insert(schema.inventoryTransactions).values({
          productId: item.productId,
          type: 'out',
          quantity: item.quantity,
          referenceId: order.id,
          notes: 'Order placed',
        });
      }

      // Clear the cart
      await tx
        .delete(schema.cartItems)
        .where(eq(schema.cartItems.userId, userId));

      return order;
    });
  }

  async getUserOrders(userId: string) {
    return this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.userId, userId))
      .orderBy(schema.orders.createdAt);
  }

  async getOrderDetails(userId: string, orderId: string) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId)));

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const items = await this.db
      .select({
        id: schema.orderItems.id,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        productName: schema.products.name,
      })
      .from(schema.orderItems)
      .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .where(eq(schema.orderItems.orderId, orderId));

    return { ...order, items };
  }

  async getOrderDetailsAsAdmin(orderId: string) {
    const [order] = await this.db
      .select({
        id: schema.orders.id,
        totalAmount: schema.orders.totalAmount,
        status: schema.orders.status,
        createdAt: schema.orders.createdAt,
        consignmentId: schema.orders.consignmentId,
        trackingUrl: schema.orders.trackingUrl,
        customerName: schema.users.fullName,
        customerEmail: schema.users.email,
        customerPhone: schema.users.phone,
        addressLine1: schema.addresses.addressLine1,
        city: schema.addresses.city,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .leftJoin(schema.addresses, eq(schema.orders.shippingAddressId, schema.addresses.id))
      .where(eq(schema.orders.id, orderId));

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const items = await this.db
      .select({
        id: schema.orderItems.id,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        productName: schema.products.name,
      })
      .from(schema.orderItems)
      .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .where(eq(schema.orderItems.orderId, orderId));

    return { ...order, items };
  }

  async getAllOrdersAsAdmin() {
    return this.db
      .select({
        id: schema.orders.id,
        userId: schema.orders.userId,
        totalAmount: schema.orders.totalAmount,
        status: schema.orders.status,
        createdAt: schema.orders.createdAt,
        customerName: schema.users.fullName,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .orderBy(desc(schema.orders.createdAt));
  }

  async updateOrderStatus(id: string, status: string) {
    let trackingUpdates = {};

    // If order is marked as 'shipped', generate a mock consignment via Courier Service
    if (status === 'shipped') {
      const orderDetails = await this.getOrderDetails(undefined as any, id); // We bypass userId check by finding the order another way, but let's just fetch it directly to be safe
      
      const [order] = await this.db.select().from(schema.orders).where(eq(schema.orders.id, id));
      if (!order) throw new NotFoundException('Order not found');

      const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, order.userId));
      const [address] = await this.db.select().from(schema.addresses).where(eq(schema.addresses.id, order.shippingAddressId));

      // Calculate quantity
      const items = await this.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id));
      const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

      const consignment = await this.courierService.createConsignment({
        orderId: id,
        recipientName: user?.fullName || 'Customer',
        recipientPhone: user?.phone || '0000000',
        recipientAddress: address?.addressLine1 || 'Unknown',
        recipientCity: address?.city || 'Unknown',
        amountToCollect: parseFloat(order.totalAmount),
        itemQuantity: totalQuantity,
        itemWeight: 1, // Mock weight
      });

      if (consignment.success) {
        trackingUpdates = {
          consignmentId: consignment.consignmentId,
          trackingUrl: consignment.trackingUrl,
        };
      }
    }

    const [updated] = await this.db
      .update(schema.orders)
      .set({ 
        status: status as any,
        ...trackingUpdates,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException('Order not found');
    }
    return updated;
  }
}
