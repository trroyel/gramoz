"use client";

import { useEffect, useState } from "react";
import { settingsApi } from "@/lib/api/settings";
import { Setting } from "@/types";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [abandonedIdleHours, setAbandonedIdleHours] = useState("24");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await settingsApi.getAllSettings();
      if (res.success && res.data) {
        setSettings(res.data);
        const idleHours = res.data.find(s => s.key === "ABANDONED_CART_IDLE_HOURS");
        if (idleHours) {
          setAbandonedIdleHours(idleHours.value);
        }
      }
    } catch (error) {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await settingsApi.updateSetting({
        key: "ABANDONED_CART_IDLE_HOURS",
        value: abandonedIdleHours,
        description: "Number of hours before a cart is considered abandoned and an email is sent.",
      });
      if (res.success) {
        toast.success("Settings saved successfully");
        fetchSettings();
      } else {
        toast.error("Failed to save settings");
      }
    } catch (error) {
      toast.error("An error occurred while saving");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Store Settings</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-2">Manage your store's configuration and automated behaviors.</p>
      </div>

      <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4 text-zinc-900 dark:text-zinc-50">Abandoned Cart Recovery</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Idle Time (Hours)
            </label>
            <input
              type="number"
              min="1"
              max="720"
              value={abandonedIdleHours}
              onChange={(e) => setAbandonedIdleHours(e.target.value)}
              className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
            />
            <p className="text-xs text-zinc-500 mt-2">
              The number of hours a cart must remain idle before the recovery email is sent automatically.
            </p>
          </div>
          
          <Button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white rounded-xl mt-4">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
