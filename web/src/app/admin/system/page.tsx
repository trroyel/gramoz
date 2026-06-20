"use client";

import { useEffect, useState } from "react";
import { healthApi, HealthReport } from "@/lib/api/health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckCircle2, XCircle, Loader2, Database, HardDrive, Server } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export default function SystemHealthPage() {
  const [healthData, setHealthData] = useState<HealthReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHealth = async () => {
    setIsLoading(true);
    try {
      const data = await healthApi.getHealth();
      setHealthData(data);
    } catch (error: any) {
      toast.error(error.message || "Failed to fetch system health");
      setHealthData({ status: "error", error: { api: { status: "down", message: error.message } } });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    // Poll every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    if (status === "ok" || status === "up") return "text-green-600 bg-green-50 dark:bg-green-900/20";
    if (status === "error" || status === "down") return "text-red-600 bg-red-50 dark:bg-red-900/20";
    return "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20";
  };

  const getStatusIcon = (status: string) => {
    if (status === "ok" || status === "up") return <CheckCircle2 className="w-5 h-5 text-green-600" />;
    if (status === "error" || status === "down") return <XCircle className="w-5 h-5 text-red-600" />;
    return <Activity className="w-5 h-5 text-yellow-600 animate-pulse" />;
  };

  const getServiceIcon = (key: string) => {
    if (key.includes("database") || key.includes("prisma")) return <Database className="w-6 h-6 text-zinc-500" />;
    if (key.includes("redis")) return <HardDrive className="w-6 h-6 text-zinc-500" />;
    return <Server className="w-6 h-6 text-zinc-500" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            System Health
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            Real-time status of backend services and dependencies.
          </p>
        </div>
        <Button onClick={fetchHealth} disabled={isLoading} variant="outline" className="gap-2">
          <Activity className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading && !healthData ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Overall Status Card */}
          <Card className="col-span-full md:col-span-1 lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" /> Overall API Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-900 rounded-xl border">
                <div className={`p-4 rounded-full mb-4 ${getStatusColor(healthData?.status || 'error')}`}>
                   {getStatusIcon(healthData?.status || 'error')}
                </div>
                <h3 className="text-2xl font-bold capitalize mb-1">
                  {healthData?.status || "Unknown"}
                </h3>
                <p className="text-sm text-zinc-500 text-center">
                  {healthData?.status === "ok" 
                    ? "All systems are operational and responding normally."
                    : "Some services are experiencing degraded performance or downtime."}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Individual Services Cards */}
          <div className="col-span-full md:col-span-1 lg:col-span-2 grid gap-4 sm:grid-cols-2">
            {healthData?.details && Object.entries(healthData.details).map(([key, value]) => (
              <Card key={key}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex justify-between items-center text-lg capitalize">
                    <div className="flex items-center gap-2">
                      {getServiceIcon(key)}
                      {key.replace(/_/g, " ")}
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase flex items-center gap-1 border ${getStatusColor(value.status)}`}>
                      {value.status === "up" && <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse" />}
                      {value.status === "down" && <span className="w-1.5 h-1.5 rounded-full bg-red-600" />}
                      {value.status}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(value).map(([infoKey, infoValue]) => {
                      if (infoKey === 'status') return null;
                      return (
                        <div key={infoKey} className="flex justify-between text-sm py-1 border-b last:border-0 border-zinc-100 dark:border-zinc-800">
                          <span className="text-zinc-500 capitalize">{infoKey.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {typeof infoValue === 'object' ? JSON.stringify(infoValue) : String(infoValue)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {/* If there are errors not in details */}
            {healthData?.error && Object.entries(healthData.error).map(([key, value]) => {
               if (healthData.details?.[key]) return null; // already rendered
               return (
                <Card key={key} className="border-red-200 dark:border-red-900/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex justify-between items-center text-lg capitalize text-red-600">
                      <div className="flex items-center gap-2">
                        {getServiceIcon(key)}
                        {key.replace(/_/g, " ")}
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase flex items-center gap-1 border ${getStatusColor(value.status || 'down')}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
                        {value.status || 'down'}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/10 p-3 rounded-lg">
                       {value.message || "Service is unreachable or reporting an error."}
                    </div>
                  </CardContent>
                </Card>
               )
            })}
          </div>
        </div>
      )}
    </div>
  );
}
