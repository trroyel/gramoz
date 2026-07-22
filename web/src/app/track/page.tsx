"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Package, Search, Truck, CheckCircle2 } from "lucide-react";
import { courierApi } from "@/lib/api/courier";
import { toast } from "sonner";
import dynamic from "next/dynamic";

const TrackingMap = dynamic(() => import("@/components/tracking/tracking-map"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-xl flex items-center justify-center">
      <span className="text-zinc-400">Loading Map...</span>
    </div>
  ),
});

function TrackPackageContent() {
  const searchParams = useSearchParams();
  const initialCode = searchParams.get("code") || "";
  
  const [trackingCode, setTrackingCode] = useState(initialCode);
  const [isSearching, setIsSearching] = useState(false);
  const [trackingData, setTrackingData] = useState<any>(null);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (initialCode) {
      handleSearch(initialCode);
    }
  }, []);

  const handleSearchClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingCode.trim()) return;
    handleSearch(trackingCode.trim());
  };

  const handleSearch = async (code: string) => {
    setIsSearching(true);
    setHasSearched(true);
    setTrackingData(null);
    try {
      const res = await courierApi.trackPackage(code);
      if (res.success) {
        setTrackingData(res);
      } else {
        toast.error(res.message || "Failed to fetch tracking data.");
      }
    } catch (err) {
      toast.error("Could not reach courier service.");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Track Your Package</h1>
        <p className="text-muted-foreground">Enter your tracking code to see real-time delivery status.</p>
      </div>

      <form onSubmit={handleSearchClick} className="flex gap-2 w-full max-w-xl mx-auto">
        <Input 
          placeholder="Enter tracking code (e.g. SF-MOCK-123456)" 
          value={trackingCode}
          onChange={(e) => setTrackingCode(e.target.value)}
          className="h-12 text-lg"
          required
        />
        <Button type="submit" className="h-12 px-8" disabled={isSearching}>
          {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
        </Button>
      </form>

      {hasSearched && !isSearching && !trackingData && (
        <Card className="max-w-xl mx-auto border-red-100 bg-red-50/50">
          <CardContent className="flex flex-col items-center py-10">
            <Package className="w-12 h-12 text-red-300 mb-4" />
            <h3 className="text-lg font-semibold text-red-900">Tracking code not found</h3>
            <p className="text-red-700 mt-1">Please double-check your code and try again.</p>
          </CardContent>
        </Card>
      )}

      {trackingData && (
        <Card className="max-w-xl mx-auto overflow-hidden">
          <div className="bg-zinc-900 text-white p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-zinc-400 text-sm font-medium uppercase tracking-wider mb-1">Tracking Code</p>
                <h2 className="text-2xl font-bold font-mono">{trackingData.trackingCode}</h2>
              </div>
              <div className="text-right">
                <p className="text-zinc-400 text-sm font-medium uppercase tracking-wider mb-1">Current Status</p>
                <div className="inline-flex items-center gap-1.5 bg-green-500/20 text-green-400 px-3 py-1 rounded-full font-semibold">
                  {trackingData.currentStatus === 'Delivered' ? <CheckCircle2 className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                  {trackingData.currentStatus}
                </div>
              </div>
            </div>
            {trackingData.isMock && (
              <div className="mt-4 inline-block bg-blue-500/20 text-blue-300 text-xs px-2 py-1 rounded border border-blue-500/30">
                Mock Tracking Data
              </div>
            )}
          </div>

          {trackingData.origin && trackingData.destination && trackingData.currentLocation && (
            <div className="p-4 bg-white dark:bg-zinc-950 border-b dark:border-zinc-800">
              <TrackingMap 
                origin={trackingData.origin}
                destination={trackingData.destination}
                currentLocation={trackingData.currentLocation}
                status={trackingData.currentStatus}
              />
            </div>
          )}

          <CardContent className="p-0">
            <div className="p-6 md:p-8">
              <div className="relative space-y-8 before:absolute before:inset-0 before:ml-4 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-zinc-200 dark:before:via-zinc-700 before:to-transparent">
                
                {trackingData.timeline && trackingData.timeline.map((step: any, index: number) => {
                  const isCompleted = step.completed;
                  return (
                    <div key={index} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 bg-white dark:bg-zinc-900 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 
                        ${isCompleted ? 'border-green-500 text-green-500' : 'border-zinc-300 text-zinc-300 dark:border-zinc-700 dark:text-zinc-700'}
                      `}>
                        {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : <div className="w-2 h-2 rounded-full bg-current" />}
                      </div>
                      
                      <div className={`w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] p-4 rounded-xl border shadow-sm
                        ${isCompleted ? 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800' : 'bg-zinc-50 dark:bg-zinc-900/50 border-transparent opacity-50'}
                      `}>
                        <div className="flex flex-col md:flex-row md:items-center justify-between mb-1">
                          <h4 className={`font-bold ${isCompleted ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500'}`}>
                            {step.status}
                          </h4>
                          {step.time && (
                            <time className="text-xs font-mono text-zinc-500 mt-1 md:mt-0">
                              {new Date(step.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </time>
                          )}
                        </div>
                        <p className={`text-sm ${isCompleted ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-600'}`}>
                          {step.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function TrackPackagePage() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center py-20"><Loader2 className="w-8 h-8 animate-spin text-green-500" /></div>}>
      <TrackPackageContent />
    </Suspense>
  );
}
