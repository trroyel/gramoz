"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Heart, Globe, Leaf, Users, ShieldCheck, Sprout } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="flex flex-col flex-1 bg-zinc-50 font-sans dark:bg-black">
      <div className="container px-4 mx-auto max-w-7xl py-12 space-y-20 md:space-y-32">
        
        {/* Hero Section */}
        <section className="relative py-24 md:py-32 rounded-3xl overflow-hidden bg-green-900 text-white shadow-xl">
          <div className="absolute inset-0 z-0 bg-green-900">
            <Image 
              src="/images/about/hero.png" 
              alt="Gramoz Rural Empowerment" 
              fill
              sizes="(max-width: 1280px) 100vw, 1280px"
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-black/60 sm:bg-black/50"></div>
          </div>
          <div className="relative z-10 px-8 lg:px-16">
            <div className="max-w-3xl space-y-6">
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
                Empowering Rural Roots.
              </h1>
              <p className="text-xl md:text-2xl text-green-100 font-medium">
                We are Gramoz. Connecting the authenticity of rural artisans and farmers directly to your doorstep.
              </p>
            </div>
          </div>
        </section>

        {/* Our Story Section */}
        <section>
          <div className="grid md:grid-cols-2 gap-12 items-start">
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                The Story Behind Gramoz
              </h2>
              <div className="space-y-4 text-lg text-zinc-600 dark:text-zinc-400">
                <p>
                  Gramoz (গ্রামজ) was born out of a simple observation: the hardest working people in our communities often have the least access to fair markets. Rural farmers, traditional weavers, and local artisans produce some of the most authentic and high-quality goods, yet struggle to find a platform that respects their craft.
                </p>
                <p>
                  Our mission is to bridge this gap. By building a robust, transparent e-commerce infrastructure, we empower rural entrepreneurs to bypass middlemen. This ensures that you get the freshest, most authentic products, while the creators receive the fair compensation they truly deserve.
                </p>
              </div>
            </div>
            <div className="relative h-[400px] md:h-[500px] rounded-3xl overflow-hidden shadow-2xl">
              <Image 
                src="/images/about/farmer-tomato.jpg" 
                alt="Gramoz Community" 
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover hover:scale-105 transition-transform duration-700"
              />
            </div>
          </div>
        </section>

        {/* Core Values Section */}
        <section>
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-4">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Our Core Values
            </h2>
            <p className="text-lg text-zinc-600 dark:text-zinc-400">
              Everything we do is driven by a commitment to our community, our environment, and our customers.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-xl flex items-center justify-center mb-6">
                <Leaf className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Authentic & Organic</h3>
              <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                We prioritize products that are grown organically and crafted traditionally, preserving the true essence of rural heritage.
              </p>
            </div>

            <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 text-orange-600 rounded-xl flex items-center justify-center mb-6">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Community First</h3>
              <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Gramoz is not just a marketplace; it is a community. We invest back into the rural sectors that sustain us.
              </p>
            </div>

            <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-xl flex items-center justify-center mb-6">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">Transparent & Fair</h3>
              <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                By eliminating unnecessary middlemen, we ensure fair trade practices where producers get their rightful share.
              </p>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-white dark:bg-zinc-950 rounded-3xl border dark:border-zinc-800 p-12 md:p-24 text-center shadow-sm">
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl shadow-green-600/20">
              <Sprout className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Be Part of the Journey
            </h2>
            <p className="text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Every purchase you make helps support a rural family and sustains a local craft. Explore our catalog today.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 pt-4">
              <Button asChild size="lg" className="bg-green-600 hover:bg-green-700 text-white px-8 h-12 text-lg rounded-xl">
                <Link href="/products">Shop Now</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="px-8 h-12 text-lg border-2 rounded-xl">
                <Link href="/register">Join the Community</Link>
              </Button>
            </div>
          </div>
        </section>
        
      </div>
    </div>
  );
}
