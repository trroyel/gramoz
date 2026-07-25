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
import { CheckCircle2, PlusCircle, MapPin, Loader2, CreditCard, Banknote, Coins, Truck, Store } from "lucide-react";
import { loyaltyApi } from "@/lib/api/loyalty";
import { useRegions } from "@/hooks/queries/use-regions";
import { courierApi } from "@/lib/api/courier";
import dynamic from "next/dynamic";
import { PhoneVerificationModal } from "@/components/auth/phone-verification-modal";

const LocationPicker = dynamic(() => import("@/components/addresses/location-picker"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[300px] bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-xl flex items-center justify-center">
      <span className="text-zinc-400">Loading Map...</span>
    </div>
  ),
});

export default function CheckoutPage() {
  const router = useRouter();
  const { items, subtotal, promoCode, discountAmount } = useCartStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false);

  // ── Address state ────────────────────────────────────────────────
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newAddress, setNewAddress] = useState({ 
    addressLine1: "", 
    city: "", 
    phone: "",
    latitude: "",
    longitude: ""
  });

  const [paymentMethod, setPaymentMethod] = useState<"sslcommerz" | "bkash" | "nagad" | "cod">("sslcommerz");

  // ── Delivery state ────────────────────────────────────────────────
  const [deliveryMethod, setDeliveryMethod] = useState<"home" | "branch">("home");
  const [deliveryCharge, setDeliveryCharge] = useState(0);
  const { data: regions } = useRegions();
  const [selectedDivision, setSelectedDivision] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedZone, setSelectedZone] = useState("");

  // ── Calculate Delivery Charge ────────────────────────────────────
  useEffect(() => {
    if (selectedZone) {
      courierApi.calculateCharge({ zoneId: selectedZone, deliveryMethod, weightKg: items.length * 0.5 }).then(res => {
        // Server returns flat { success, charge, estimatedDays } — not wrapped in data
        if (res.success && typeof res.charge === 'number') setDeliveryCharge(res.charge);
      });
    } else {
      setDeliveryCharge(0);
    }
  }, [selectedZone, deliveryMethod, items]);

  // ── Loyalty state ────────────────────────────────────────────────
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [loyaltyCurrencyValue, setLoyaltyCurrencyValue] = useState(0);
  const [usePoints, setUsePoints] = useState(false);

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

    // Fetch loyalty balance
    loyaltyApi.getMyBalance().then((res) => {
      setLoyaltyBalance(res.data.balance || 0);
      setLoyaltyCurrencyValue(res.data.currencyValue || 0);
    }).catch(err => console.log("Failed to load loyalty balance", err));
  }, []);

  // ── Sync zoneId for saved addresses ─────────────────────────────
  useEffect(() => {
    if (!showNewForm && selectedAddressId && addresses.length > 0) {
      const addr = addresses.find(a => a.id === selectedAddressId);
      if (addr) {
        if (addr.zoneId) {
          // ✅ Direct lookup — reliable
          setSelectedZone(addr.zoneId);
        } else if (regions?.zones) {
          // Fallback for old addresses without zoneId: try name-match as best effort
          const zone = regions.zones.find(z => z.name === addr.city);
          setSelectedZone(zone ? zone.id : "");
        } else {
          setSelectedZone("");
        }
      }
    }
  }, [selectedAddressId, addresses, regions, showNewForm]);

  // ── Submit ───────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Determine which address details to send
    let addressLine1: string;
    let city: string;
    let phone: string;
    let latitude: string | undefined;
    let longitude: string | undefined;

    if (showNewForm || !selectedAddressId) {
      if (!newAddress.addressLine1 || !newAddress.city || !newAddress.phone) {
        toast.error("Please fill all address fields");
        return;
      }
      addressLine1 = newAddress.addressLine1;
      city = newAddress.city;
      phone = newAddress.phone;
      latitude = newAddress.latitude || undefined;
      longitude = newAddress.longitude || undefined;
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
      latitude = addr.latitude;
      longitude = addr.longitude;
    }

    setIsProcessing(true);
    try {
      const orderRes = await ordersApi.checkout({ 
        addressLine1, city, phone, promoCode, usePoints, latitude, longitude,
        zoneId: selectedZone || undefined,
        deliveryMethod 
      });
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
      if (error.message && error.message.includes("Phone number verification is required")) {
        setIsPhoneModalOpen(true);
      } else {
        toast.error(error.message || "An error occurred during checkout");
      }
      setIsProcessing(false);
    }
  };

  const pointsDiscount = usePoints ? Math.min(loyaltyCurrencyValue, subtotal - discountAmount) : 0;

  return (
    <div className="container px-4 mx-auto max-w-4xl py-12">
      <PhoneVerificationModal 
        isOpen={isPhoneModalOpen}
        onClose={() => setIsPhoneModalOpen(false)}
        onSuccess={() => {
          setIsPhoneModalOpen(false);
          // Wait briefly for modal to close, then re-trigger checkout or let user click again.
          // Since user requested "modal will close then click place order", we just close it.
        }}
      />
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
                <div className="space-y-4 pt-2">
                  <LocationPicker 
                    onLocationSelect={(lat, lng) => setNewAddress({ ...newAddress, latitude: String(lat), longitude: String(lng) })} 
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="addressLine1">Street Address</Label>
                    <Input
                      id="addressLine1"
                      placeholder="123 Main St, Apt 4B"
                      value={newAddress.addressLine1}
                      onChange={(e) => setNewAddress({ ...newAddress, addressLine1: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Division</Label>
                      <select
                        className="flex h-10 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:ring-offset-zinc-950 dark:placeholder:text-zinc-400 dark:focus:ring-zinc-300"
                        value={selectedDivision}
                        onChange={(e) => {
                          setSelectedDivision(e.target.value);
                          setSelectedDistrict("");
                          setSelectedZone("");
                        }}
                      >
                        <option value="">Select Division</option>
                        {regions?.divisions.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label>District</Label>
                      <select
                        className="flex h-10 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:ring-offset-zinc-950 dark:placeholder:text-zinc-400 dark:focus:ring-zinc-300"
                        value={selectedDistrict}
                        onChange={(e) => {
                          setSelectedDistrict(e.target.value);
                          setSelectedZone("");
                        }}
                        disabled={!selectedDivision}
                      >
                        <option value="">Select District</option>
                        {regions?.districts.filter(d => d.divisionId === selectedDivision).map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5 md:col-span-2">
                      <Label>Zone / Area</Label>
                      <select
                        className="flex h-10 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:ring-offset-zinc-950 dark:placeholder:text-zinc-400 dark:focus:ring-zinc-300"
                        value={selectedZone}
                        onChange={(e) => {
                          setSelectedZone(e.target.value);
                          const zoneName = regions?.zones.find(z => z.id === e.target.value)?.name || "";
                          setNewAddress({ ...newAddress, city: zoneName });
                        }}
                        disabled={!selectedDistrict}
                      >
                        <option value="">Select Zone</option>
                        {regions?.zones.filter(z => z.districtId === selectedDistrict).map(z => (
                          <option key={z.id} value={z.id}>{z.name}</option>
                        ))}
                      </select>
                    </div>
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

              {/* Zone picker for saved addresses that have no stored zoneId yet */}
              {!showNewForm && selectedAddressId && !selectedZone && (
                <div className="space-y-3 pt-3 border-t dark:border-zinc-800">
                  <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                    ⚠️ Please select your delivery zone to calculate shipping cost.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Division</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:ring-zinc-300"
                        value={selectedDivision}
                        onChange={(e) => { setSelectedDivision(e.target.value); setSelectedDistrict(""); setSelectedZone(""); }}
                      >
                        <option value="">Select Division</option>
                        {regions?.divisions.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>District</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:ring-zinc-300"
                        value={selectedDistrict}
                        onChange={(e) => { setSelectedDistrict(e.target.value); setSelectedZone(""); }}
                        disabled={!selectedDivision}
                      >
                        <option value="">Select District</option>
                        {regions?.districts.filter(d => d.divisionId === selectedDivision).map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label>Zone / Area</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:ring-zinc-300"
                        value={selectedZone}
                        onChange={(e) => setSelectedZone(e.target.value)}
                        disabled={!selectedDistrict}
                      >
                        <option value="">Select Zone</option>
                        {regions?.zones.filter(z => z.districtId === selectedDistrict).map(z => (
                          <option key={z.id} value={z.id}>{z.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Delivery Method */}
              {selectedZone && (
                <div className="pt-4 border-t dark:border-zinc-800">
                  <Label className="text-base font-semibold mb-3 block">Delivery Method</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setDeliveryMethod('home')}
                      className={`flex flex-col items-center justify-center p-4 border rounded-xl transition-all text-sm font-semibold ${
                        deliveryMethod === 'home'
                          ? "border-purple-600 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                      }`}
                    >
                      <Truck className="w-6 h-6 mb-1.5" />
                      Home Delivery
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveryMethod('branch')}
                      className={`flex flex-col items-center justify-center p-4 border rounded-xl transition-all text-sm font-semibold ${
                        deliveryMethod === 'branch'
                          ? "border-purple-600 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                      }`}
                    >
                      <Store className="w-6 h-6 mb-1.5" />
                      Branch Pickup
                    </button>
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
          
          {/* Loyalty Section */}
          {loyaltyBalance > 0 && (
            <div className="mb-6 bg-white dark:bg-zinc-800 border dark:border-zinc-700 p-4 rounded-xl flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center">
                  <Coins className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
                </div>
                <div>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">Loyalty Rewards</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    You have <span className="font-bold text-yellow-600 dark:text-yellow-500">{loyaltyBalance} points</span>
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={usePoints}
                  onChange={(e) => setUsePoints(e.target.checked)}
                />
                <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-green-600"></div>
              </label>
            </div>
          )}

          <div className="space-y-4 mb-6 max-h-[300px] overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="flex justify-between items-center text-sm">
                <div className="flex flex-col">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {item.quantity}x {item.productName}
                  </span>
                  {item.variantAttributes && Object.keys(item.variantAttributes).length > 0 && (
                    <span className="text-xs text-zinc-400 mt-0.5">
                      {Object.entries(item.variantAttributes).map(([k, v]) => `${v}`).join(' / ')}
                    </span>
                  )}
                </div>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  ৳{(parseFloat(item.productPrice) * item.quantity).toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {discountAmount > 0 && (
            <div className="flex justify-between items-center text-green-600 font-medium mb-2">
              <span>Promo Discount</span>
              <span>-৳{discountAmount.toFixed(2)}</span>
            </div>
          )}

          {usePoints && pointsDiscount > 0 && (
            <div className="flex justify-between items-center text-yellow-600 font-medium mb-2">
              <span>Loyalty Points Applied</span>
              <span>-৳{pointsDiscount.toFixed(2)}</span>
            </div>
          )}

          <div className="border-t dark:border-zinc-800 pt-4 mt-4">
            <div className="flex justify-between items-center text-zinc-600 dark:text-zinc-400 mb-2">
              <span>Subtotal</span>
              <span>৳{subtotal.toFixed(2)}</span>
            </div>
            {deliveryCharge > 0 && (
              <div className="flex justify-between items-center text-zinc-600 dark:text-zinc-400 mb-2">
                <span>Delivery Charge</span>
                <span>৳{deliveryCharge.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between items-center font-bold text-xl text-zinc-900 dark:text-zinc-50 mt-4">
              <span>Total</span>
              <span>৳{Math.max(0, subtotal - discountAmount - pointsDiscount + deliveryCharge).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
