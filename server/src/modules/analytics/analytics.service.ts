import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { sql, eq, and, gte, desc } from 'drizzle-orm';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async getDashboardStats() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 1. Total Revenue and Order Count
    const totalsResult = await this.db.execute<{
      total_revenue: string;
      total_orders: string;
    }>(sql`
      SELECT 
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COUNT(id) as total_orders
      FROM orders
      WHERE status NOT IN ('cancelled', 'refunded')
    `);
    const totals = totalsResult.rows[0];

    // 2. Total Products
    const productsCountResult = await this.db.execute<{ count: string }>(sql`
      SELECT COUNT(id) as count FROM products
    `);
    const productsCount = productsCountResult.rows[0];

    // 3. Low Stock Products
    const lowStockThreshold = 5;
    const lowStockProducts = await this.db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        stock: schema.products.stock,
      })
      .from(schema.products)
      .where(sql`${schema.products.stock} <= ${lowStockThreshold}`)
      .orderBy(schema.products.stock)
      .limit(5);

    // 4. Daily Revenue for the last 30 days
    const dailyRevenueResult = await this.db.execute<{
      date: string;
      revenue: string;
    }>(sql`
      SELECT 
        DATE(created_at) as date,
        SUM(total_amount) as revenue
      FROM orders
      WHERE status NOT IN ('cancelled', 'refunded')
        AND created_at >= ${thirtyDaysAgo.toISOString()}
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);

    // Format daily revenue to ensure all 30 days are present
    const dailyRevenue = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      const found = dailyRevenueResult.rows.find((r: any) => {
        // Postgres DATE might return as Date object or string depending on driver
        const rowDate =
          typeof r.date === 'string'
            ? r.date.split('T')[0]
            : r.date.toISOString().split('T')[0];
        return rowDate === dateStr;
      });

      dailyRevenue.push({
        date: dateStr,
        revenue: found ? parseFloat(found.revenue) : 0,
      });
    }

    // 5. Recent Orders
    const recentOrders = await this.db.query.orders.findMany({
      limit: 5,
      orderBy: [desc(schema.orders.createdAt)],
      with: {
        user: {
          columns: {
            fullName: true,
          },
        },
        payments: {
          limit: 1,
          orderBy: [desc(schema.payments.createdAt)],
        },
      },
    });

    const formattedRecentOrders = recentOrders.map((order) => ({
      ...order,
      customerName: order.user?.fullName,
      payment: order.payments[0] || null,
      payments: undefined,
    }));

    return {
      totalRevenue: parseFloat(totals?.total_revenue) || 0,
      totalOrders: parseInt(totals?.total_orders, 10) || 0,
      totalProducts: parseInt(productsCount?.count, 10) || 0,
      lowStockProducts,
      dailyRevenue,
      recentOrders: formattedRecentOrders,
    };
  }
}
