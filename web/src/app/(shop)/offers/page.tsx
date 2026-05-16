import { Metadata } from "next";
import Link from "next/link";
import { Tag, Clock, Copy, ArrowRight, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Special Offers & Promotions | Gramoz",
  description: "Discover exclusive discounts and promotions on authentic rural products at Gramoz.",
};

const OFFERS = [
  {
    id: 1,
    title: "First Purchase Discount",
    description: "Get 15% off your very first order of authentic rural products.",
    code: "WELCOME15",
    discount: "15% OFF",
    validUntil: "Dec 31, 2026",
    color: "bg-green-600",
  },
  {
    id: 2,
    title: "Organic Honey Bundle",
    description: "Buy 2 jars of our premium Sundarbans honey and get 1 free.",
    code: "HONEYB3",
    discount: "BUY 2 GET 1",
    validUntil: "Limited Time",
    color: "bg-orange-600",
  },
  {
    id: 3,
    title: "Free Shipping",
    description: "Enjoy free nationwide delivery on all orders above ৳1,500.",
    code: "FREESHIP1500",
    discount: "FREE DELIVERY",
    validUntil: "Ongoing",
    color: "bg-blue-600",
  },
  {
    id: 4,
    title: "Handicrafts Mega Sale",
    description: "Flat 20% discount on all bamboo and cane handicrafts.",
    code: "CRAFT20",
    discount: "20% OFF",
    validUntil: "Nov 30, 2026",
    color: "bg-purple-600",
  },
];

export default function OffersPage() {
  return (
    <div className="flex flex-col flex-1 bg-zinc-50 font-sans dark:bg-black">
      <div className="container px-4 mx-auto max-w-7xl py-12 space-y-12 md:space-y-16">
        
        {/* Header Banner */}
        <section className="bg-green-900 text-white py-16 md:py-20 relative overflow-hidden rounded-3xl shadow-xl">
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white via-transparent to-transparent"></div>
          <div className="relative z-10 text-center space-y-4 px-6">
            <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-6 backdrop-blur-md">
              <Percent className="w-8 h-8 text-green-300" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
              Special Offers & Promotions
            </h1>
            <p className="text-lg md:text-xl text-green-100 max-w-2xl mx-auto">
              Enjoy exclusive savings on authentic rural products. Use these promo codes at checkout to claim your discount!
            </p>
          </div>
        </section>

        {/* Offers Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-6 md:gap-8">
          {OFFERS.map((offer) => (
            <div 
              key={offer.id} 
              className="bg-white dark:bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row"
            >
              {/* Left Side: Discount Badge */}
              <div className={`${offer.color} text-white p-6 md:w-2/5 flex flex-col justify-center items-center text-center space-y-2 relative overflow-hidden`}>
                <div className="absolute -right-4 -bottom-4 opacity-20">
                  <Tag className="w-24 h-24" />
                </div>
                <span className="font-bold text-2xl md:text-3xl relative z-10 leading-tight">
                  {offer.discount}
                </span>
              </div>
              
              {/* Right Side: Details */}
              <div className="p-6 md:p-8 flex-1 flex flex-col justify-between space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
                    {offer.title}
                  </h3>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {offer.description}
                  </p>
                </div>
                
                <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
                  <div className="bg-zinc-100 dark:bg-zinc-950 px-4 py-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-between w-full xl:w-auto font-mono text-sm group cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 mr-4 tracking-wide">
                      {offer.code}
                    </span>
                    <Copy className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
                  </div>
                  
                  <div className="flex items-center text-xs font-medium text-orange-600 dark:text-orange-500 bg-orange-50 dark:bg-orange-900/20 px-3 py-1.5 rounded-full whitespace-nowrap">
                    <Clock className="w-3.5 h-3.5 mr-1.5" />
                    Valid till: {offer.validUntil}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA Section */}
        <section className="bg-white dark:bg-zinc-950 rounded-3xl border dark:border-zinc-800 p-12 md:p-24 text-center shadow-sm">
          <div className="max-w-3xl mx-auto space-y-8">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Ready to start saving?
            </h2>
            <p className="text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Head over to our product catalog to discover fresh, authentic goods directly from the source. Don't forget to apply your promo code at checkout!
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