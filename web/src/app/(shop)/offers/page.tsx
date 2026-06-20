"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Tag,
  Clock,
  Copy,
  Check,
  ArrowRight,
  Percent,
  Loader2,
  Frown,
  BadgePercent,
  Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { promosApi, type Promo } from "@/lib/api/promos";

// Rotate through a palette of accent colours for the discount badges
const BADGE_COLORS = [
  "from-green-600 to-emerald-500",
  "from-orange-500 to-amber-400",
  "from-blue-600 to-sky-400",
  "from-purple-600 to-violet-400",
  "from-rose-500 to-pink-400",
  "from-teal-600 to-cyan-400",
];

function formatDiscount(promo: Promo): string {
  if (promo.discountType === "percentage") {
    return `${parseFloat(promo.discountValue).toFixed(0)}% OFF`;
  }
  return `৳${parseFloat(promo.discountValue).toFixed(0)} OFF`;
}

function formatExpiry(promo: Promo): string {
  if (!promo.expiresAt) return "No expiry";
  return new Date(promo.expiresAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function PromoCard({ promo, index }: { promo: Promo; index: number }) {
  const [copied, setCopied] = useState(false);
  const color = BADGE_COLORS[index % BADGE_COLORS.length];

  const handleCopy = () => {
    navigator.clipboard.writeText(promo.code).then(() => {
      setCopied(true);
      toast.success(`Copied "${promo.code}" to clipboard!`);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const hasMinOrder = promo.minOrderValue && parseFloat(promo.minOrderValue) > 0;
  const usesLeft =
    promo.maxUses !== null ? promo.maxUses - promo.currentUses : null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col md:flex-row group">
      {/* Left: Discount Badge */}
      <div
        className={`bg-gradient-to-br ${color} text-white p-6 md:w-2/5 flex flex-col justify-center items-center text-center space-y-2 relative overflow-hidden flex-shrink-0`}
      >
        <div className="absolute -right-5 -bottom-5 opacity-15">
          <Tag className="w-28 h-28" />
        </div>
        <div className="relative z-10 space-y-1">
          {promo.discountType === "percentage" ? (
            <BadgePercent className="w-8 h-8 mx-auto mb-2 opacity-80" />
          ) : (
            <Banknote className="w-8 h-8 mx-auto mb-2 opacity-80" />
          )}
          <span className="font-black text-3xl md:text-4xl leading-none tracking-tight">
            {formatDiscount(promo)}
          </span>
        </div>
      </div>

      {/* Right: Details */}
      <div className="p-6 md:p-8 flex-1 flex flex-col justify-between gap-5">
        <div className="space-y-1.5">
          {/* No custom title in DB — use code as heading */}
          <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            {promo.code}
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {promo.discountType === "percentage"
              ? `Get ${parseFloat(promo.discountValue).toFixed(0)}% off your order`
              : `Flat ৳${parseFloat(promo.discountValue).toFixed(0)} discount on your order`}
            {hasMinOrder && (
              <> on orders above <span className="font-semibold text-zinc-700 dark:text-zinc-300">৳{parseFloat(promo.minOrderValue!).toFixed(0)}</span></>
            )}
            .
          </p>
          {usesLeft !== null && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              Only {usesLeft} use{usesLeft !== 1 ? "s" : ""} remaining!
            </p>
          )}
        </div>

        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-3">
          {/* Copy Code Button */}
          <button
            onClick={handleCopy}
            className="bg-zinc-100 dark:bg-zinc-950 px-4 py-2.5 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-between w-full xl:w-auto font-mono text-sm hover:bg-zinc-200 dark:hover:bg-zinc-800 active:scale-95 transition-all cursor-pointer"
            title="Copy promo code"
          >
            <span className="font-bold text-zinc-900 dark:text-zinc-100 mr-4 tracking-widest">
              {promo.code}
            </span>
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
            )}
          </button>

          {/* Expiry */}
          <div className="flex items-center text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-3 py-1.5 rounded-full whitespace-nowrap border border-orange-100 dark:border-orange-800/30">
            <Clock className="w-3.5 h-3.5 mr-1.5 shrink-0" />
            {promo.expiresAt ? `Expires: ${formatExpiry(promo)}` : "No expiry date"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OffersPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    promosApi
      .getPublicPromos()
      .then((res) => {
        if (res.success) setPromos(res.data);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 font-sans dark:bg-black">
      <div className="container px-4 mx-auto max-w-7xl py-12 space-y-12 md:space-y-16">

        {/* Header Banner */}
        <section className="bg-green-900 text-white py-16 md:py-20 relative overflow-hidden rounded-3xl shadow-xl">
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white via-transparent to-transparent" />
          <div className="relative z-10 text-center space-y-4 px-6">
            <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-6 backdrop-blur-md">
              <Percent className="w-8 h-8 text-green-300" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
              Special Offers &amp; Promotions
            </h1>
            <p className="text-lg md:text-xl text-green-100 max-w-2xl mx-auto">
              Enjoy exclusive savings on authentic rural products. Click any code to copy it, then paste at checkout!
            </p>
          </div>
        </section>

        {/* Promos Grid */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-zinc-400">
            <Loader2 className="w-10 h-10 animate-spin" />
            <p className="text-sm">Loading offers…</p>
          </div>
        ) : promos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center text-zinc-400 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800">
            <Frown className="w-12 h-12 opacity-40" />
            <p className="text-lg font-semibold text-zinc-600 dark:text-zinc-400">No active offers right now</p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Check back soon — new deals drop regularly!</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
            {promos.map((promo, i) => (
              <PromoCard key={promo.id} promo={promo} index={i} />
            ))}
          </div>
        )}

        {/* CTA */}
        <section className="bg-white dark:bg-zinc-950 rounded-3xl border dark:border-zinc-800 p-12 md:p-24 text-center shadow-sm">
          <div className="max-w-3xl mx-auto space-y-8">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Ready to start saving?
            </h2>
            <p className="text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Head over to our product catalog to discover fresh, authentic goods directly from the source. Don&apos;t forget to apply your promo code at checkout!
            </p>
            <Button asChild size="lg" className="bg-green-600 hover:bg-green-700 text-white rounded-xl h-12 px-8">
              <Link href="/products">
                Explore Products <ArrowRight className="ml-2 w-4 h-4" />
              </Link>
            </Button>
          </div>
        </section>

      </div>
    </div>
  );
}