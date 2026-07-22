"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Package, ShoppingCart, Loader2, AlertTriangle } from "lucide-react";
import { analyticsApi } from "@/lib/api/analytics";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    totalProducts: 0,
    recentOrders: [] as any[],
    lowStockProducts: [] as any[],
    dailyRevenue: [] as any[],
  });

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const res = await analyticsApi.getDashboardStats();
        if (res.success && res.data) {
          setStats(res.data);
        }
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
      value: stats.totalOrders.toLocaleString(),
      icon: ShoppingCart,
      color: "text-blue-600 dark:text-blue-500",
      bg: "bg-blue-100 dark:bg-blue-900/20",
    },
    {
      title: "Total Products",
      value: stats.totalProducts.toLocaleString(),
      icon: Package,
      color: "text-orange-600 dark:text-orange-500",
      bg: "bg-orange-100 dark:bg-orange-900/20",
    },
    {
      title: "Low Stock Items",
      value: stats.lowStockProducts.length.toString(),
      icon: AlertTriangle,
      color: stats.lowStockProducts.length > 0 ? "text-red-600 dark:text-red-500" : "text-zinc-600 dark:text-zinc-500",
      bg: stats.lowStockProducts.length > 0 ? "bg-red-100 dark:bg-red-900/20" : "bg-zinc-100 dark:bg-zinc-900/20",
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

      {/* Revenue Chart */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Revenue (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            {stats.dailyRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.dailyRevenue} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(date) => {
                      const d = new Date(date);
                      return `${d.getDate()} ${d.toLocaleString('default', { month: 'short' })}`;
                    }}
                    stroke="#888888" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <YAxis 
                    stroke="#888888" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(value) => `৳${value}`}
                  />
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <Tooltip 
                    formatter={(value: any) => [`৳${Number(value).toLocaleString()}`, "Revenue"]}
                    labelFormatter={(label) => new Date(label as string).toLocaleDateString()}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#16a34a" fillOpacity={1} fill="url(#colorRevenue)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-500">
                No revenue data for this period
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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
                        <td className="py-4 pr-4 font-medium font-mono text-xs">{order.id}</td>
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

        {/* Low Stock Warning Card */}
        <Card className="col-span-1 border-0 shadow-sm flex flex-col p-6 bg-gradient-to-br from-red-500 to-red-700 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <AlertTriangle className="w-32 h-32" />
          </div>
          <div className="relative z-10 w-full flex-1 flex flex-col">
            <div className="flex items-center gap-2 mb-6">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-xl font-bold">Low Stock Alerts</h3>
            </div>
            
            <div className="flex-1 space-y-4">
              {stats.lowStockProducts.length === 0 ? (
                <div className="text-red-100 text-sm text-center py-8">
                  All products are fully stocked!
                </div>
              ) : (
                stats.lowStockProducts.map(product => (
                  <div key={product.id} className="bg-white/10 rounded-lg p-3 backdrop-blur-sm border border-white/20 flex justify-between items-center">
                    <div>
                      <div className="font-medium truncate max-w-[150px]">{product.name}</div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div className="text-lg font-bold">{product.stock}</div>
                      <div className="text-[10px] text-red-100 uppercase tracking-wide">Left</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
