import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ArrowRight, Leaf, ShieldCheck, Truck, ShoppingBag, Store, Gift } from "lucide-react";
import { ProductGrid } from "@/components/home/product-grid";
import { productsApi } from "@/lib/api/products";
import { Product } from "@/types";

const CATEGORIES = [
  { name: "Organic Food", icon: Leaf, color: "bg-green-100 dark:bg-green-900/30 text-green-600" },
  { name: "Handicrafts", icon: ShoppingBag, color: "bg-orange-100 dark:bg-orange-900/30 text-orange-600" },
  { name: "Clothing", icon: Store, color: "bg-blue-100 dark:bg-blue-900/30 text-blue-600" },
  { name: "Accessories", icon: Gift, color: "bg-purple-100 dark:bg-purple-900/30 text-purple-600" },
];

const TRUST_BADGES = [
  { title: "100% Organic", desc: "Sourced directly from nature", icon: Leaf },
  { title: "Fair Trade", desc: "Empowering rural artisans", icon: ShieldCheck },
  { title: "Fast Delivery", desc: "Nationwide secure shipping", icon: Truck },
];

export default async function Home() {
  let featuredProducts: Product[] = [];
  try {
    const response = await productsApi.getAll({ sort: "newest" });
    if (response.success) {
      // Just take the first 4 for featured section
      featuredProducts = response.data.slice(0, 4);
    }
  } catch {
    // silently fall back to empty
  }

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black font-sans">
      
      {/* Hero Section */}
      <section className="container px-4 mx-auto max-w-7xl pt-6 pb-10 md:pt-8 md:pb-16">
        <div className="relative w-full h-[380px] md:h-[450px] rounded-3xl overflow-hidden flex items-center shadow-2xl">
          {/* Background Image inside container */}
          <div className="absolute inset-0 z-0 bg-zinc-900">
            <Image 
              src="/images/about/hero.png" 
              alt="Gramoz Rural Empowerment" 
              fill 
              sizes="(max-width: 1280px) 100vw, 1280px"
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 sm:via-black/40 to-transparent"></div>
          </div>

          {/* Content aligned to the left */}
          <div className="relative z-10 px-6 sm:px-10 md:px-16 w-full">
            <div className="max-w-2xl space-y-4 md:space-y-6 text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/20 border border-green-500/30 text-green-300 text-xs md:text-sm font-medium backdrop-blur-md">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Fresh Arrivals Every Week
              </div>
              <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-[1.1]">
                Authentic Rural Products, <br className="hidden md:block"/>
                <span className="text-green-400">Delivered to You.</span>
              </h1>
              <p className="text-base md:text-lg text-zinc-200 max-w-xl">
                Discover high-quality, handcrafted, and organic goods sourced directly from the hardworking farmers and artisans of Bangladesh.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-start gap-3 md:gap-4 pt-2">
                <Button asChild size="lg" className="bg-green-600 hover:bg-green-700 text-white h-10 md:h-12 px-6 md:px-8 text-base md:text-lg rounded-xl shadow-lg shadow-green-600/20 w-full sm:w-auto border-0">
                  <Link href="/products">Shop Now</Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-10 md:h-12 px-6 md:px-8 text-base md:text-lg rounded-xl border-2 border-white/30 text-white hover:bg-white/10 w-full sm:w-auto bg-black/20 backdrop-blur-sm">
                  <Link href="/about">Our Story</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust & Categories Merged Section */}
      <section className="container px-4 mx-auto max-w-7xl pt-4 pb-12 md:pb-16 space-y-6 md:space-y-8">
        
        {/* Trust Badges */}
        <div className="bg-white dark:bg-zinc-900/50 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-zinc-200 dark:divide-zinc-800">
            {TRUST_BADGES.map((badge, idx) => {
              const Icon = badge.icon;
              return (
                <div key={idx} className="flex items-center justify-center md:justify-start gap-4 pt-6 md:pt-0 md:px-6 first:pt-0 first:md:pl-0 last:md:pr-0">
                  <div className="flex-shrink-0 w-12 h-12 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center text-green-600">
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-zinc-900 dark:text-zinc-50">{badge.title}</h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{badge.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Categories Grid (No Title) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {CATEGORIES.map((cat, idx) => {
            const Icon = cat.icon;
            return (
              <Link key={idx} href={`/products?category=${encodeURIComponent(cat.name)}`} className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 md:p-8 text-center hover:shadow-xl transition-all hover:-translate-y-1">
                <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 ${cat.color}`}>
                  <Icon className="w-8 h-8" />
                </div>
                <h3 className="font-bold text-zinc-900 dark:text-zinc-50">{cat.name}</h3>
              </Link>
            );
          })}
        </div>

      </section>

      {/* Featured Products */}
      <section className="py-4 bg-white dark:bg-zinc-950 border-y border-zinc-200 dark:border-zinc-800">
        <ProductGrid
          title="Trending Products"
          description="Handpicked authentic items loved by our community."
          showViewAll
          initialProducts={featuredProducts}
        />
      </section>

      {/* Promo Banner */}
      <section className="py-16 md:py-24">
        <div className="container px-4 mx-auto max-w-7xl">
          <div className="bg-green-900 rounded-3xl overflow-hidden relative shadow-2xl flex flex-col md:flex-row items-center">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white via-transparent to-transparent"></div>
            <div className="p-10 md:p-16 relative z-10 flex-1 space-y-6 text-center md:text-left">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
                Get 15% Off Your First Order
              </h2>
              <p className="text-lg text-green-100 max-w-lg mx-auto md:mx-0">
                Join Gramoz today and support rural empowerment while enjoying premium authentic products.
              </p>
              <Button asChild size="lg" className="bg-white text-green-900 hover:bg-zinc-100 h-12 px-8 rounded-xl font-bold">
                <Link href="/offers">View Offers</Link>
              </Button>
            </div>
            <div className="hidden md:block relative w-1/3 min-h-[300px] h-full">
               <Image 
                  src="/images/about/community.png" 
                  alt="Gramoz Offers" 
                  fill
                  sizes="33vw"
                  className="object-cover"
                />
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
