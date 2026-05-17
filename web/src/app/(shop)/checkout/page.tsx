"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/stores/cart-store";
import { ordersApi } from "@/lib/api/orders";
import { paymentsApi } from "@/lib/api/payments";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CheckoutPage() {
  const router = useRouter();
  const { items, subtotal } = useCartStore();
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [formData, setFormData] = useState({
    addressLine1: "",
    city: "",
    phone: "",
  });

  useEffect(() => {
    if (items.length === 0) {
      router.push("/cart");
    }
  }, [items, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.addressLine1 || !formData.city || !formData.phone) {
      toast.error("Please fill all fields");
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Create order (this also creates address in backend now)
      const orderRes = await ordersApi.checkout(formData);
      
      if (!orderRes.success) {
        throw new Error(orderRes.message || "Checkout failed");
      }
      
      const orderId = orderRes.data.id;
      toast.success("Order created! Initiating payment...");

      // 2. Initiate Payment
      const payRes = await paymentsApi.initiate(orderId);
      
      if (payRes.success && payRes.data.gatewayUrl) {
        // Redirect to SSLCommerz
        window.location.href = payRes.data.gatewayUrl;
      } else {
        throw new Error("Failed to get payment gateway URL");
      }
      
    } catch (error: any) {
      toast.error(error.message || "An error occurred during checkout");
      setIsProcessing(false);
    }
  };

  return (
    <div className="container px-4 mx-auto max-w-4xl py-12">
      <h1 className="text-3xl font-bold mb-8 text-center">Checkout</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div>
          <h2 className="text-xl font-semibold mb-6">Shipping Details</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="addressLine1">Street Address</Label>
              <Input 
                id="addressLine1" 
                placeholder="123 Main St, Apt 4B" 
                value={formData.addressLine1}
                onChange={(e) => setFormData({...formData, addressLine1: e.target.value})}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="city">City / District</Label>
              <Input 
                id="city" 
                placeholder="Dhaka" 
                value={formData.city}
                onChange={(e) => setFormData({...formData, city: e.target.value})}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input 
                id="phone" 
                placeholder="01700000000" 
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                required
              />
            </div>
            
            <Button 
              type="submit" 
              className="w-full h-12 mt-6 bg-green-600 hover:bg-green-700 text-lg"
              disabled={isProcessing}
            >
              {isProcessing ? "Processing..." : "Pay with SSLCommerz"}
            </Button>
          </form>
        </div>
        
        <div className="bg-zinc-50 dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-6">Order Summary</h2>
          <div className="space-y-4 mb-6 max-h-[300px] overflow-y-auto">
            {items.map(item => (
              <div key={item.id} className="flex justify-between items-center text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {item.quantity}x {item.productName}
                </span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  ৳{(parseFloat(item.productPrice) * item.quantity).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          
          <div className="border-t dark:border-zinc-800 pt-4 space-y-2">
            <div className="flex justify-between font-bold text-lg">
              <span>Total Pay</span>
              <span>৳{subtotal.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
