import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CheckoutCancelPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <div className="w-20 h-20 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mb-6">
        <AlertCircle className="w-10 h-10 text-orange-600 dark:text-orange-500" />
      </div>
      
      <h1 className="text-3xl md:text-4xl font-bold mb-4 text-zinc-900 dark:text-zinc-50">
        Payment Cancelled
      </h1>
      
      <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-md mb-8">
        You cancelled the payment process. You can always try again from your cart when you are ready.
      </p>
      
      <div className="flex flex-col sm:flex-row gap-4">
        <Button asChild className="h-12 px-8">
          <Link href="/cart">Return to Cart</Link>
        </Button>
      </div>
    </div>
  );
}
