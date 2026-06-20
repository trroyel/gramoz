"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ordersApi } from "@/lib/api/orders";
import { Order } from "@/types";
import { Loader2, ArrowLeft, Package, MapPin, Truck, CheckCircle2, XCircle, Clock, Banknote } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

export default function OrderDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchOrderDetails = async () => {
      try {
        const res = await ordersApi.getOrder(id as string);
        if (res.success && res.data) {
          setOrder(res.data);
        } else {
          toast.error("Failed to load order details");
          router.push("/dashboard/orders");
        }
      } catch (error) {
        console.error("Failed to fetch order details:", error);
        toast.error("Failed to load order details");
        router.push("/dashboard/orders");
      } finally {
        setIsLoading(false);
      }
    };

    if (id) {
      fetchOrderDetails();
    }
  }, [id, router]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (!order) return null;

  const isCod = !order.payment || order.payment.method?.toUpperCase() === "COD";

  const paymentBadge = () => {
    if (!order.payment) return <span className="font-semibold text-muted-foreground italic">No Payment</span>;

    // COD — static informational label, not a live status
    if (isCod) {
      return (
        <div className="flex items-center gap-1.5 font-semibold text-zinc-500 dark:text-zinc-400">
          <Banknote className="w-4 h-4" />
          <span>Pay on delivery</span>
        </div>
      );
    }

    const map: Record<string, { color: string; icon: React.ReactNode }> = {
      completed: { color: "text-green-600", icon: <CheckCircle2 className="w-4 h-4" /> },
      failed:    { color: "text-red-500",   icon: <XCircle className="w-4 h-4" /> },
      pending:   { color: "text-yellow-600",icon: <Clock className="w-4 h-4" /> },
    };
    const style = map[order.payment.status] ?? map.pending;
    return (
      <div className={`flex items-center gap-1.5 font-semibold capitalize ${style.color}`}>
        {style.icon}
        <span>{order.payment.status}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/dashboard/orders">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Order Details
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
            #{order.id} • Placed on {new Date(order.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Left Column: Order Items */}
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-zinc-500" />
                Items Ordered
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {order.items?.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-4 md:p-6 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                    <div className="flex items-center gap-4">
                      {/* Placeholder for item image if we add it to the API later */}
                      <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-zinc-400" />
                      </div>
                      <div>
                        <h4 className="font-medium text-zinc-900 dark:text-zinc-100 line-clamp-2">
                          {item.productName}
                        </h4>
                        <p className="text-sm text-zinc-500 mt-1">
                          Qty: {item.quantity} × ৳{item.unitPrice}
                        </p>
                      </div>
                    </div>
                    <div className="font-semibold whitespace-nowrap ml-4">
                      ৳{(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Summary & Status */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-zinc-500">
                  <span>Subtotal</span>
                  <span>৳{order.totalAmount}</span>
                </div>
                {/* Note: The API currently returns totalAmount which already has discount subtracted. 
                    If we want to show shipping and discount, we need the API to return those fields clearly. */}
                <div className="flex justify-between font-bold text-base pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  <span>Total</span>
                  <span>৳{order.totalAmount}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Fulfillment</p>
                  <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full capitalize
                    ${order.status === 'delivered'  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
                    ${order.status === 'processing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : ''}
                    ${order.status === 'shipped'    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : ''}
                    ${order.status === 'pending'    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''}
                    ${order.status === 'cancelled'  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : ''}
                  `}>
                    {order.status}
                  </span>
                </div>

                <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
                   <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Payment</p>
                   {paymentBadge()}
                   {order.payment && (
                     <p className="text-xs text-muted-foreground uppercase mt-1">Method: {order.payment.method}</p>
                   )}
                </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
