"use client";

import { useEffect, useState } from "react";
import { settingsApi } from "@/lib/api/settings";
import { Settings, Save, AlertCircle, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LoyaltySettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    textReviewPoints: "50",
    mediaReviewPoints: "100",
    validityDays: "365",
    currencyRatio: "100",
  });

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      const res = await settingsApi.getAllSettings();
      const settingsMap = new Map(res.data.map((s) => [s.key, s.value]));

      setFormData({
        textReviewPoints: settingsMap.get("LOYALTY_POINTS_TEXT_REVIEW") || "50",
        mediaReviewPoints: settingsMap.get("LOYALTY_POINTS_MEDIA_REVIEW") || "100",
        validityDays: settingsMap.get("LOYALTY_POINTS_VALIDITY_DAYS") || "365",
        currencyRatio: settingsMap.get("LOYALTY_POINTS_TO_CURRENCY_RATIO") || "100",
      });
    } catch (err: any) {
      setError(err.message || "Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      await Promise.all([
        settingsApi.updateSetting({ key: "LOYALTY_POINTS_TEXT_REVIEW", value: formData.textReviewPoints, description: "Points for text review" }),
        settingsApi.updateSetting({ key: "LOYALTY_POINTS_MEDIA_REVIEW", value: formData.mediaReviewPoints, description: "Points for media review" }),
        settingsApi.updateSetting({ key: "LOYALTY_POINTS_VALIDITY_DAYS", value: formData.validityDays, description: "Days until points expire" }),
        settingsApi.updateSetting({ key: "LOYALTY_POINTS_TO_CURRENCY_RATIO", value: formData.currencyRatio, description: "Points equal to 1 currency unit" })
      ]);
      alert("Settings saved successfully");
    } catch (err: any) {
      setError(err.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-zinc-500">Loading settings...</div>;
  }

  return (
    <div className="container px-4 py-8 mx-auto space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <Coins className="w-6 h-6 text-yellow-500" />
          Loyalty & Rewards Settings
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-1">
          Configure how many points customers earn for reviews and their redemption value.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-start gap-3 border border-red-100 dark:bg-red-900/20 dark:border-red-900/50 dark:text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Points for Text Review
            </label>
            <input
              type="number"
              className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.textReviewPoints}
              onChange={(e) => setFormData({ ...formData, textReviewPoints: e.target.value })}
            />
            <p className="text-xs text-zinc-500 mt-1">Points awarded for leaving a text comment.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Points for Media Review
            </label>
            <input
              type="number"
              className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.mediaReviewPoints}
              onChange={(e) => setFormData({ ...formData, mediaReviewPoints: e.target.value })}
            />
            <p className="text-xs text-zinc-500 mt-1">Points awarded if the review includes images/videos.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Points Expiration (Days)
            </label>
            <input
              type="number"
              className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.validityDays}
              onChange={(e) => setFormData({ ...formData, validityDays: e.target.value })}
            />
            <p className="text-xs text-zinc-500 mt-1">How many days until earned points expire (0 = never expire).</p>
          </div>

          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Currency Ratio (Redemption Value)
            </label>
            <input
              type="number"
              className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={formData.currencyRatio}
              onChange={(e) => setFormData({ ...formData, currencyRatio: e.target.value })}
            />
            <p className="text-xs text-zinc-500 mt-1">How many points equal exactly $1.00 off at checkout.</p>
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Settings"}
            {!isSaving && <Save className="w-4 h-4 ml-2" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
