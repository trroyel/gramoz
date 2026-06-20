"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/stores/cart-store";
import { ordersApi } from "@/lib/api/orders";
import { paymentsApi } from "@/lib/api/payments";
import { addressesApi } from "@/lib/api/addresses";
import { Address } from "@/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, PlusCircle, MapPin, Loader2, CreditCard, Banknote } from "lucide-react";

export default function CheckoutPage() {
  const router = useRouter();
  const { items, subtotal, promoCode, discountAmount } = useCartStore();
  const [isProcessing, setIsProcessing] = useState(false);

  // ── Address state ────────────────────────────────────────────────
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newAddress, setNewAddress] = useState({ addressLine1: "", city: "", phone: "" });

  const [paymentMethod, setPaymentMethod] = useState<"sslcommerz" | "bkash" | "nagad" | "cod">("sslcommerz");

  // ── Redirect empty cart ──────────────────────────────────────────
  useEffect(() => {
    if (items.length === 0) router.push("/cart");
  }, [items, router]);

  // ── Load saved addresses ─────────────────────────────────────────
  useEffect(() => {
    addressesApi.getAddresses().then((res) => {
      const list = res.data ?? [];
      setAddresses(list);

      // Auto-select the default address if one exists
      const def = list.find((a) => a.isDefault) ?? list[0];
      if (def) {
        setSelectedAddressId(def.id);
      } else {
        // No saved addresses → show the new address form immediately
        setShowNewForm(true);
      }
      setLoadingAddresses(false);
    });
  }, []);

  // ── Submit ───────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Determine which address details to send
    let addressLine1: string;
    let city: string;
    let phone: string;

    if (showNewForm || !selectedAddressId) {
      if (!newAddress.addressLine1 || !newAddress.city || !newAddress.phone) {
        toast.error("Please fill all address fields");
        return;
      }
      addressLine1 = newAddress.addressLine1;
      city = newAddress.city;
      phone = newAddress.phone;
    } else {
      const addr = addresses.find((a) => a.id === selectedAddressId);
      if (!addr) {
        toast.error("Selected address not found");
        return;
      }
      addressLine1 = addr.addressLine1;
      city = addr.city;
      // Use saved phone from address label/title if phone field exists, otherwise keep empty
      phone = (addr as any).phone ?? addr.title ?? "";
    }

    setIsProcessing(true);
    try {
      const orderRes = await ordersApi.checkout({ addressLine1, city, phone, promoCode });
      if (!orderRes.success) throw new Error(orderRes.message || "Checkout failed");

      const orderId = orderRes.data?.id;
      if (!orderId) throw new Error("Order was created but ID is missing. Please contact support.");
      toast.success("Order created! Initiating payment…");

      const payRes = await paymentsApi.initiate(orderId, paymentMethod);
      if (payRes.success) {
        if (paymentMethod === "cod") {
          toast.success("Order confirmed!");
          router.push("/checkout/success");
        } else if (payRes.data?.gatewayUrl) {
          window.location.href = payRes.data.gatewayUrl;
        } else {
          throw new Error("Failed to get payment gateway URL");
        }
      } else {
        throw new Error(payRes.message || "Payment initiation failed");
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
        {/* ── LEFT: Shipping + Payment ── */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Shipping Address</h2>

          {loadingAddresses ? (
            <div className="flex items-center gap-2 text-zinc-500 py-6">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading your addresses…</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Saved address list */}
              {addresses.length > 0 && (
                <div className="space-y-2">
                  {addresses.map((addr) => (
                    <button
                      key={addr.id}
                      type="button"
                      onClick={() => { setSelectedAddressId(addr.id); setShowNewForm(false); }}
                      className={`w-full text-left flex items-start gap-3 p-4 rounded-xl border transition-all ${
                        selectedAddressId === addr.id && !showNewForm
                          ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                      }`}
                    >
                      <div className="mt-0.5">
                        {selectedAddressId === addr.id && !showNewForm ? (
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        ) : (
                          <MapPin className="w-5 h-5 text-zinc-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                          {addr.title}
                          {addr.isDefault && (
                            <span className="ml-2 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                              Default
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {addr.addressLine1}{addr.addressLine2 ? `, ${addr.addressLine2}` : ""}, {addr.city}
                          {addr.zipCode ? ` ${addr.zipCode}` : ""}
                        </p>
                      </div>
                    </button>
                  ))}

                  {/* Toggle new address form */}
                  <button
                    type="button"
                    onClick={() => { setShowNewForm(!showNewForm); setSelectedAddressId(null); }}
                    className={`w-full text-left flex items-center gap-3 p-4 rounded-xl border transition-all ${
                      showNewForm
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                        : "border-dashed border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600"
                    }`}
                  >
                    <PlusCircle className={`w-5 h-5 ${showNewForm ? "text-blue-600" : "text-zinc-400"}`} />
                    <span className={`text-sm font-medium ${showNewForm ? "text-blue-600" : "text-zinc-500"}`}>
                      Use a different address
                    </span>
                  </button>
                </div>
              )}

              {/* New address form */}
              {showNewForm && (
                <div className="space-y-3 pt-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="addressLine1">Street Address</Label>
                    <Input
                      id="addressLine1"
                      placeholder="123 Main St, Apt 4B"
                      value={newAddress.addressLine1}
                      onChange={(e) => setNewAddress({ ...newAddress, addressLine1: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="city">City / District</Label>
                    <Input
                      id="city"
                      placeholder="Dhaka"
                      value={newAddress.city}
                      onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                      id="phone"
                      placeholder="01700000000"
                      value={newAddress.phone}
                      onChange={(e) => setNewAddress({ ...newAddress, phone: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* Payment Method */}
              <div className="pt-4 border-t dark:border-zinc-800">
                <Label className="text-base font-semibold mb-3 block">Payment Method</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { 
                      id: "bkash", 
                      label: "bKash", 
                      color: "border-[#e2136e] bg-[#e2136e]/5 dark:bg-[#e2136e]/10 text-[#e2136e]",
                      icon: (
                        <img 
                          src="https://freelogopng.com/images/all_img/1656234782bkash-app-logo.png" 
                          alt="bKash" 
                          className="h-8 mb-1.5 object-contain" 
                        />
                      )
                    },
                    { 
                      id: "nagad", 
                      label: "Nagad", 
                      color: "border-[#f7931e] bg-[#f7931e]/5 dark:bg-[#f7931e]/10 text-[#f7931e]",
                      icon: (
                        <img 
                          src="https://freelogopng.com/images/all_img/1679248787Nagad-Logo.png" 
                          alt="Nagad" 
                          className="h-8 mb-1.5 object-contain" 
                        />
                      )
                    },
                    { 
                      id: "sslcommerz", 
                      label: "Cards & More", 
                      color: "border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400",
                      icon: <CreditCard className="w-6 h-6 mb-1.5" />
                    },
                    { 
                      id: "cod", 
                      label: "Cash on Delivery", 
                      color: "border-green-600 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400",
                      icon: <Banknote className="w-6 h-6 mb-1.5" />
                    },
                  ].map((pm) => (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => setPaymentMethod(pm.id as any)}
                      className={`flex flex-col items-center justify-center p-4 border rounded-xl transition-all text-sm font-semibold ${
                        paymentMethod === pm.id
                          ? pm.color
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                      }`}
                    >
                      {pm.icon}
                      {pm.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 mt-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 text-lg"
                disabled={isProcessing || (!selectedAddressId && !showNewForm)}
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Processing…</span>
                ) : "Complete Order"}
              </Button>
            </form>
          )}
        </div>

        {/* ── RIGHT: Order Summary ── */}
        <div className="bg-zinc-50 dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-6">Order Summary</h2>
          <div className="space-y-4 mb-6 max-h-[300px] overflow-y-auto">
            {items.map((item) => (
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

          {discountAmount > 0 && (
            <div className="flex justify-between items-center text-green-600 font-medium mb-2">
              <span>Discount</span>
              <span>-৳{discountAmount.toFixed(2)}</span>
            </div>
          )}

          <div className="border-t dark:border-zinc-800 pt-4 mt-4">
            <div className="flex justify-between items-center font-bold text-xl text-zinc-900 dark:text-zinc-50">
              <span>Total</span>
              <span>৳{Math.max(0, subtotal - discountAmount).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
