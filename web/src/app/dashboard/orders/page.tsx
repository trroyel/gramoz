"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Truck, Loader2, CreditCard, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { ordersApi } from "@/lib/api/orders";
import { paymentsApi } from "@/lib/api/payments";
import { Order } from "@/types";
import { toast } from "sonner";

const isCod = (order: Order) => order.payment?.method?.toUpperCase() === "COD";

// An order needs payment action only if it's a non-COD order with an unpaid/failed payment.
// COD orders are never actioned online — the customer pays the delivery agent in person.
const needsPayment = (order: Order) =>
  order.status === "pending" &&
  !isCod(order) &&
  (!order.payment || order.payment.status === "failed" || order.payment.status === "pending");

const getPaymentWarning = (order: Order): { title: string; desc: string } => {
  if (!order.payment)
    return { title: "⚠️ Payment required", desc: "This order is reserved but won't be processed until payment is completed." };
  if (order.payment.status === "pending")
    return { title: "⏳ Payment incomplete", desc: "Your payment was started but not confirmed — this happens if you closed the payment page early. Please try again." };
  if (order.payment.status === "failed")
    return { title: "❌ Payment failed", desc: "Your previous payment attempt failed. Please try again with the same or a different method." };
  return { title: "⚠️ Payment required", desc: "" };
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);

  // Payment method picker state per order
  const [payMethodMap, setPayMethodMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await ordersApi.getOrders();
        if (res.success && res.data) {
          setOrders(res.data);
          // Default each unpaid order to sslcommerz
          const defaults: Record<string, string> = {};
          res.data.forEach((o) => { if (needsPayment(o)) defaults[o.id] = "sslcommerz"; });
          setPayMethodMap(defaults);
        }
      } catch (error) {
        console.error("Failed to fetch orders:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchOrders();
  }, []);

  const handlePayNow = async (orderId: string) => {
    const method = payMethodMap[orderId] ?? "sslcommerz";
    setPayingOrderId(orderId);
    try {
      const payRes = await paymentsApi.initiate(orderId, method);
      if (payRes.success) {
        if (method === "cod") {
          toast.success("Cash on Delivery confirmed!");
          // Refresh orders list
          const res = await ordersApi.getOrders();
          if (res.success && res.data) setOrders(res.data);
        } else if (payRes.data?.gatewayUrl) {
          window.location.href = payRes.data.gatewayUrl;
        } else {
          throw new Error("No gateway URL returned");
        }
      } else {
        throw new Error("Payment initiation failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to initiate payment");
    } finally {
      setPayingOrderId(null);
    }
  };

  const paymentBadge = (order: Order) => {
    if (!order.payment) return null;

    // COD — always show a static informational label, never a status badge
    if (isCod(order)) {
      return (
        <div className="flex items-center gap-1 font-semibold text-zinc-500 dark:text-zinc-400">
          <Package className="w-3.5 h-3.5" />
          <span>Pay on delivery</span>
        </div>
      );
    }

    const map: Record<string, { color: string; icon: React.ReactNode }> = {
      completed: { color: "text-green-600", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
      failed:    { color: "text-red-500",   icon: <XCircle className="w-3.5 h-3.5" /> },
      pending:   { color: "text-yellow-600",icon: <Clock className="w-3.5 h-3.5" /> },
    };
    const style = map[order.payment.status] ?? map.pending;
    return (
      <div className={`flex items-center gap-1 font-semibold capitalize ${style.color}`}>
        {style.icon}
        <span>{order.payment.status}</span>
      </div>
    );
  };

  // COD is intentionally excluded from the retry panel — switching to COD
  // after an online payment attempt fails is not supported (delivery agent
  // won't know the payment method changed). The customer should contact support.
  const PAYMENT_METHODS = [
    { id: "bkash",      label: "bKash",       logo: "https://freelogopng.com/images/all_img/1656234782bkash-app-logo.png" },
    { id: "nagad",      label: "Nagad",        logo: "https://freelogopng.com/images/all_img/1679248787Nagad-Logo.png" },
    { id: "sslcommerz", label: "Cards & More", logo: null },
  ];

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
                  <p className="font-semibold font-mono text-xs">#{order.id}</p>
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
                  <p className="text-sm font-medium text-muted-foreground">Payment</p>
                  {order.payment ? (
                    <div>
                      {paymentBadge(order)}
                      <p className="text-xs text-muted-foreground uppercase">{order.payment.method}</p>
                    </div>
                  ) : (
                    <p className="font-semibold text-muted-foreground italic text-sm">No Payment</p>
                  )}
                </div>
                <div className="mt-4 md:mt-0 flex flex-col items-end gap-2">
                  <div className="flex flex-col items-end">
                    <p className="text-sm font-medium text-muted-foreground mb-1">Fulfillment</p>
                    <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full capitalize
                      ${order.status === 'delivered'  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
                      ${order.status === 'processing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : ''}
                      ${order.status === 'shipped'    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : ''}
                      ${order.status === 'pending'    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''}
                      ${order.status === 'cancelled'  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : ''}
                    `}>
                      {order.status}
                    </span>
                  </div>
                  <Button variant="outline" size="sm" asChild className="mt-2 hidden md:flex">
                    <a href={`/dashboard/orders/${order.id}`}>View Details</a>
                  </Button>
                </div>
              </div>

              {/* Mobile view details button */}
              <div className="md:hidden border-t p-4 bg-muted/5 flex justify-center">
                 <Button variant="outline" size="sm" asChild className="w-full">
                    <a href={`/dashboard/orders/${order.id}`}>View Details</a>
                 </Button>
              </div>

              {/* ── Pay Now panel — only for unpaid/failed pending orders ── */}
              {needsPayment(order) && (
                <div className="p-5 bg-amber-50 dark:bg-amber-900/10 border-t border-amber-200 dark:border-amber-800/40">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1">
                      {(() => {
                        const w = getPaymentWarning(order);
                        return (
                          <>
                            <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">{w.title}</p>
                            <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">{w.desc}</p>
                          </>
                        );
                      })()}
                    </div>

                    {/* Method selector */}
                    <div className="flex flex-wrap gap-2">
                      {PAYMENT_METHODS.map((pm) => (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => setPayMethodMap((prev) => ({ ...prev, [order.id]: pm.id }))}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                            payMethodMap[order.id] === pm.id
                              ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                              : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-400"
                          }`}
                        >
                          {pm.logo ? (
                            <img src={pm.logo} alt={pm.label} className="h-4 object-contain" />
                          ) : (
                            <CreditCard className="w-3.5 h-3.5" />
                          )}
                          {pm.label}
                        </button>
                      ))}
                    </div>

                    <Button
                      size="sm"
                      className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                      disabled={payingOrderId === order.id}
                      onClick={() => handlePayNow(order.id)}
                    >
                      {payingOrderId === order.id ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Processing…</>
                      ) : (
                        <><CreditCard className="w-3.5 h-3.5 mr-1.5" /> Pay ৳{order.totalAmount}</>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
