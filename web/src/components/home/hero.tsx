import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-green-50 to-white dark:from-green-950/20 dark:to-background">
      <div className="container mx-auto px-4 py-20 md:py-32">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              <span>Empowering Rural Entrepreneurs</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
              Grow Your Rural Business{" "}
              <span className="text-green-600 dark:text-green-500">Online</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl">
              Gramoz (গ্রামজ) connects rural entrepreneurs with customers nationwide. 
              Manage inventory, track orders, and grow your business with our simple platform.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/auth/register">
                <Button size="lg" className="bg-green-600 hover:bg-green-700 gap-2 w-full sm:w-auto">
                  Get Started Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="#products">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  Browse Products
                </Button>
              </Link>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-6 pt-8 border-t">
              <div>
                <div className="text-2xl md:text-3xl font-bold text-green-600">500+</div>
                <div className="text-sm text-muted-foreground">Entrepreneurs</div>
              </div>
              <div>
                <div className="text-2xl md:text-3xl font-bold text-green-600">10K+</div>
                <div className="text-sm text-muted-foreground">Products</div>
              </div>
              <div>
                <div className="text-2xl md:text-3xl font-bold text-green-600">50K+</div>
                <div className="text-sm text-muted-foreground">Orders</div>
              </div>
            </div>
          </div>

          {/* Right Image/Illustration */}
          <div className="relative hidden lg:block">
            <div className="relative aspect-square rounded-2xl bg-gradient-to-br from-green-400 to-green-600 p-8 shadow-2xl">
              <div className="absolute inset-0 bg-grid-white/10 rounded-2xl" />
              <div className="relative h-full flex items-center justify-center">
                <div className="text-white text-center space-y-4">
                  <div className="text-6xl font-bold">গ্রামজ</div>
                  <div className="text-xl">Rural E-Commerce Platform</div>
                </div>
              </div>
            </div>
            {/* Floating Cards */}
            <div className="absolute -top-4 -right-4 bg-white dark:bg-card p-4 rounded-lg shadow-lg">
              <div className="text-sm font-medium">📦 Fast Delivery</div>
            </div>
            <div className="absolute -bottom-4 -left-4 bg-white dark:bg-card p-4 rounded-lg shadow-lg">
              <div className="text-sm font-medium">💰 Best Prices</div>
            </div>
          </div>
        </div>
      </div>

      {/* Background Pattern */}
      <div className="absolute inset-0 -z-10 h-full w-full bg-white dark:bg-background bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]" />
    </section>
  );
}
