"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Truck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { ordersApi } from "@/lib/api/orders";
import { Order } from "@/types";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await ordersApi.getOrders();
        if (res.success && res.data) {
          setOrders(res.data);
        }
      } catch (error) {
        console.error("Failed to fetch orders:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchOrders();
  }, []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          My Orders
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-2">
          View and track your recent orders.
        </p>
      </div>

      <Card className="border-dashed border-2 bg-muted/20">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-4">
            <Truck className="w-8 h-8 text-primary" />
          </div>
          <CardTitle>Order Tracking System</CardTitle>
          <CardDescription className="max-w-md mx-auto">
            This module will integrate with external Courier APIs (like Pathao, Steadfast, etc.) to provide real-time tracking updates directly on this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-8 pt-4">
          <Button disabled variant="outline">API Integration Pending</Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-green-600" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-card rounded-xl border">
          <Package className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <p className="text-muted-foreground mb-1 text-lg font-medium">No orders found</p>
          <p className="text-sm text-muted-foreground">When you place an order, it will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <Card key={order.id} className="overflow-hidden">
              <div className="flex flex-col md:flex-row md:items-center justify-between p-6 bg-muted/10 border-b">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Order ID</p>
                  <p className="font-semibold">#{order.id}</p>
                </div>
                <div className="mt-4 md:mt-0">
                  <p className="text-sm font-medium text-muted-foreground">Date Placed</p>
                  <p className="font-semibold">{new Date(order.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="mt-4 md:mt-0">
                  <p className="text-sm font-medium text-muted-foreground">Total Amount</p>
                  <p className="font-semibold">৳{order.totalAmount}</p>
                </div>
                <div className="mt-4 md:mt-0">
                  <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full capitalize
                    ${order.status === 'delivered' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
                    ${order.status === 'processing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : ''}
                    ${order.status === 'shipped' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : ''}
                    ${order.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''}
                    ${order.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : ''}
                  `}>
                    {order.status}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
