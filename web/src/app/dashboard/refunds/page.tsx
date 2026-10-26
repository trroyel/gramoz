"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { refundsApi } from "@/lib/api/refunds";
import { Refund } from "@/types";
import { Loader2, ReceiptText, Clock, CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function MyRefundsPage() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRefunds = async () => {
      try {
        const res = await refundsApi.getMyRefunds();
        if (res.success && res.data) {
          setRefunds(res.data);
        }
      } catch {
        toast.error("Failed to load your refunds");
      } finally {
        setIsLoading(false);
      }
    };
    fetchRefunds();
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'processed': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'processing': return <Clock className="w-5 h-5 text-amber-500" />;
      case 'rejected': return <XCircle className="w-5 h-5 text-red-500" />;
      default: return <Clock className="w-5 h-5 text-yellow-500" />;
    }
  };

  const formatReason = (reason: string) => {
    return reason.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          My Refunds
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-sm mt-1">
          Track the status of your refund requests.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {refunds.length === 0 ? (
            <div className="p-10 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                <ReceiptText className="w-8 h-8 text-zinc-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No refunds requested</h3>
              <p className="text-zinc-500 text-sm mb-6 max-w-md mx-auto">
                You haven&apos;t requested any refunds yet. You can request a refund from the Order Details page of any delivered order.
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/orders">View My Orders</Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {refunds.map((refund) => (
                <div key={refund.id} className="p-6 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    
                    <div className="flex items-start gap-4">
                      <div className="mt-1">
                        {getStatusIcon(refund.status)}
                      </div>
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <h4 className="font-semibold text-lg">
                            Refund of ৳{Number(refund.amount).toFixed(2)}
                          </h4>
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full capitalize
                            ${refund.status === 'processed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
                            ${refund.status === 'processing' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : ''}
                            ${refund.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : ''}
                            ${refund.status === 'requested' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''}
                          `}>
                            {refund.status}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                          Order #{refund.orderId} • Reason: {formatReason(refund.reason)}
                        </p>
                        {refund.status === 'processing' && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            In-flight: processing with payment gateway and issuing bank.
                          </p>
                        )}
                        <p className="text-xs text-zinc-500 mt-2">
                          Requested on {new Date(refund.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <Button variant="ghost" size="icon" asChild className="shrink-0 self-end sm:self-center">
                      <Link href={`/dashboard/orders/${refund.orderId}`}>
                        <ChevronRight className="w-5 h-5 text-zinc-400" />
                      </Link>
                    </Button>
                  </div>

                  {refund.adminNotes && (
                    <div className="mt-4 ml-9 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-md text-sm border-l-2 border-zinc-300 dark:border-zinc-600">
                      <strong>Admin Note:</strong> {refund.adminNotes}
                    </div>
                  )}

                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
