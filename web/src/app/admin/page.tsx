"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Package, ShoppingCart, TrendingUp, Loader2 } from "lucide-react";
import { ordersApi } from "@/lib/api/orders";
import { productsApi } from "@/lib/api/products";

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    totalProducts: 0,
    recentOrders: [] as any[],
  });

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const [ordersRes, productsRes] = await Promise.all([
          ordersApi.getAllAsAdmin(),
          productsApi.getAll(),
        ]);

        let revenue = 0;
        let ordersCount = 0;
        let recent = [];

        if (ordersRes.success && ordersRes.data) {
          const orders = ordersRes.data;
          ordersCount = orders.length;
          
          revenue = orders.reduce((sum, order) => {
            if (order.status !== 'cancelled') {
              return sum + parseFloat(order.totalAmount);
            }
            return sum;
          }, 0);

          recent = orders.slice(0, 5); // top 5 recent orders
        }

        let productsCount = 0;
        if (productsRes.success && productsRes.data) {
          productsCount = productsRes.data.length;
        }

        setStats({
          totalRevenue: revenue,
          totalOrders: ordersCount,
          totalProducts: productsCount,
          recentOrders: recent,
        });

      } catch (error) {
        console.error("Failed to load dashboard data", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const STATS_CARDS = [
    {
      title: "Total Revenue",
      value: `৳${stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: DollarSign,
      color: "text-green-600 dark:text-green-500",
      bg: "bg-green-100 dark:bg-green-900/20",
    },
    {
      title: "Total Orders",
      value: stats.totalOrders.toString(),
      icon: ShoppingCart,
      color: "text-blue-600 dark:text-blue-500",
      bg: "bg-blue-100 dark:bg-blue-900/20",
    },
    {
      title: "Total Products",
      value: stats.totalProducts.toString(),
      icon: Package,
      color: "text-orange-600 dark:text-orange-500",
      bg: "bg-orange-100 dark:bg-orange-900/20",
    },
    {
      title: "Active Views",
      value: "1,234",
      icon: TrendingUp,
      color: "text-purple-600 dark:text-purple-500",
      bg: "bg-purple-100 dark:bg-purple-900/20",
    },
  ];

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Welcome back, {user?.fullName?.split(" ")[0] || "Admin"}! 👋
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-2">
          Here is what's happening with your store today.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {STATS_CARDS.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Card key={i} className="border-0 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  {stat.title}
                </CardTitle>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stat.bg}`}>
                  <Icon className={`w-4 h-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="col-span-2 border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-zinc-500 dark:text-zinc-400 border-b dark:border-zinc-800">
                  <tr>
                    <th className="font-medium pb-3 pr-4">Order ID</th>
                    <th className="font-medium pb-3 pr-4">Customer</th>
                    <th className="font-medium pb-3 pr-4">Date</th>
                    <th className="font-medium pb-3 pr-4">Status</th>
                    <th className="font-medium pb-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-zinc-800">
                  {stats.recentOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-zinc-500">No recent orders</td>
                    </tr>
                  ) : (
                    stats.recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td className="py-4 pr-4 font-medium">{order.id}</td>
                        <td className="py-4 pr-4">{order.customerName || 'Unknown'}</td>
                        <td className="py-4 pr-4 text-zinc-500">{new Date(order.createdAt).toLocaleDateString()}</td>
                        <td className="py-4 pr-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize
                            ${order.status === 'delivered' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
                            ${order.status === 'processing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : ''}
                            ${order.status === 'shipped' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : ''}
                            ${order.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''}
                            ${order.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : ''}
                          `}>
                            {order.status}
                          </span>
                        </td>
                        <td className="py-4 text-right font-medium">৳{order.totalAmount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 border-0 shadow-sm flex flex-col justify-center items-center text-center p-8 bg-gradient-to-br from-green-500 to-green-700 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <TrendingUp className="w-48 h-48" />
          </div>
          <div className="relative z-10 w-full space-y-4">
            <h3 className="text-2xl font-bold">Pro Features Unlocked</h3>
            <p className="text-green-100 text-sm">
              Thanks to your consistent selling, you've been upgraded to a featured entrepreneur.
            </p>
            <button className="bg-white text-green-700 px-6 py-2 rounded-full font-semibold text-sm w-full shadow-lg hover:shadow-xl transition-all">
              Manage Promos
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
