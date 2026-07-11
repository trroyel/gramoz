"use client";

import { useEffect, useState } from "react";
import { loyaltyApi } from "@/lib/api/loyalty";
import { LoyaltyPoint } from "@/types";
import { Coins, ArrowDownToLine, ArrowUpFromLine, CalendarClock } from "lucide-react";
import { format } from "date-fns";

export default function LoyaltyDashboardPage() {
  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState<LoyaltyPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const [balanceRes, historyRes] = await Promise.all([
          loyaltyApi.getMyBalance(),
          loyaltyApi.getMyHistory()
        ]);
        setBalance(balanceRes.data.balance || 0);
        setHistory(historyRes.data || []);
      } catch (err) {
        console.error("Failed to load loyalty data", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  if (isLoading) {
    return <div className="p-8 text-center text-zinc-500">Loading your loyalty profile...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Loyalty Rewards</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-1">Manage your points and earn rewards.</p>
      </div>

      <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-3xl p-8 text-white flex flex-col md:flex-row items-center justify-between shadow-lg">
        <div>
          <p className="text-green-100 font-medium mb-2">Available Balance</p>
          <div className="flex items-end gap-2">
            <span className="text-5xl font-bold tracking-tight">{balance}</span>
            <span className="text-xl mb-1 opacity-90">Points</span>
          </div>
        </div>
        <div className="mt-6 md:mt-0 p-4 bg-white/10 rounded-2xl backdrop-blur-sm border border-white/20 flex items-center gap-4">
          <Coins className="w-10 h-10 text-yellow-300" />
          <div>
            <p className="text-sm font-medium opacity-90">Points Value</p>
            <p className="font-bold text-lg">Use at Checkout</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mb-4">Points History</h2>
        
        {history.length === 0 ? (
          <div className="text-center p-8 text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
            You haven't earned any points yet.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {history.map((point) => {
              const isEarned = point.points > 0;
              return (
                <div key={point.id} className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      isEarned 
                        ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {isEarned ? <ArrowDownToLine className="w-5 h-5" /> : <ArrowUpFromLine className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100 capitalize">
                        {point.type.replace('_', ' ')}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-zinc-500">
                        <span>{format(new Date(point.createdAt), 'MMM d, yyyy')}</span>
                        {point.validUntil && (
                          <span className="flex items-center gap-1 text-orange-500">
                            <CalendarClock className="w-3 h-3" />
                            Expires: {format(new Date(point.validUntil), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className={`font-bold text-lg ${isEarned ? 'text-green-600' : 'text-red-600'}`}>
                    {isEarned ? '+' : ''}{point.points}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
