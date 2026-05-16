"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OrdersPage() {
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

      <div className="flex flex-col items-center justify-center py-16 text-center bg-card rounded-xl border">
        <Package className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
        <p className="text-muted-foreground mb-1 text-lg font-medium">No orders found</p>
        <p className="text-sm text-muted-foreground">When you place an order, it will appear here.</p>
      </div>
    </div>
  );
}
