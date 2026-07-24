"use client";

import { useEffect, useState } from "react";
import { Loader2, Truck, Save, Settings, Map } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { courierApi, RegionsData, Zone } from "@/lib/api/courier";
import { toast } from "sonner";

export default function AdminCourierPage() {
  const [activeTab, setActiveTab] = useState<'settings' | 'zones'>('settings');
  
  // Settings State
  const [settings, setSettings] = useState({ mode: 'mock', apiKey: '', secretKey: '' });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Zones State
  const [regionsData, setRegionsData] = useState<RegionsData | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editCharges, setEditCharges] = useState({ homeDeliveryCharge: '', branchPickupCharge: '' });
  const [isSavingZone, setIsSavingZone] = useState(false);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>('');
  const [selectedDistrictId, setSelectedDistrictId] = useState<string>('');

  const fetchSettings = async () => {
    try {
      const res = await courierApi.getSettings();
      if (res.success && res.data) {
        setSettings(res.data);
      }
    } catch (error) {
      toast.error("Failed to load courier settings");
    }
  };

  const fetchZones = async () => {
    try {
      const res = await courierApi.getAdminZones();
      if (res.success && res.data) {
        setRegionsData(res.data);
      }
    } catch (error) {
      toast.error("Failed to load regions");
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await Promise.all([fetchSettings(), fetchZones()]);
      setIsLoading(false);
    };
    init();
  }, []);

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const res = await courierApi.updateSettings(settings);
      if (res.success) {
        toast.success("Courier settings saved successfully!");
      } else {
        toast.error("Failed to save settings");
      }
    } catch (error) {
      toast.error("An error occurred");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleEditZone = (zone: Zone) => {
    setEditingZoneId(zone.id);
    setEditCharges({
      homeDeliveryCharge: zone.homeDeliveryCharge,
      branchPickupCharge: zone.branchPickupCharge
    });
  };

  const handleSaveZone = async (zoneId: string) => {
    setIsSavingZone(true);
    try {
      const res = await courierApi.updateZoneCharge(zoneId, editCharges);
      if (res.success) {
        toast.success("Zone charges updated!");
        setEditingZoneId(null);
        await fetchZones(); // refresh
      } else {
        toast.error("Failed to update zone");
      }
    } catch (error) {
      toast.error("An error occurred");
    } finally {
      setIsSavingZone(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="container px-4 py-8 mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-2">
          <Truck className="w-8 h-8 text-green-600" />
          Shipping & Courier Management
        </h1>
        <p className="text-zinc-500">Configure Courier APIs and Delivery Charges</p>
      </div>

      {regionsData && (
        <div style={{ display: 'none' }}>
          {/* We compute filtered zones here to avoid re-rendering issues */}
          {(() => {
            return null;
          })()}
        </div>
      )}

      <div className="flex gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-2">
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'settings' 
              ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' 
              : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
        >
          <Settings className="w-4 h-4" /> API Settings
        </button>
        <button
          onClick={() => setActiveTab('zones')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'zones' 
              ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100' 
              : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
        >
          <Map className="w-4 h-4" /> Zones & Charges
        </button>
      </div>

      {activeTab === 'settings' && (
        <Card className="max-w-2xl border-zinc-200 dark:border-zinc-800">
          <CardHeader>
            <CardTitle>Steadfast Courier API Settings</CardTitle>
            <CardDescription>
              Configure your courier mode. Use <b>Mock Mode</b> for testing without making real requests to Steadfast.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label>Operating Mode</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 flex-1">
                  <input
                    type="radio"
                    name="mode"
                    value="mock"
                    checked={settings.mode === 'mock'}
                    onChange={() => setSettings({ ...settings, mode: 'mock' })}
                    className="accent-green-600"
                  />
                  <div>
                    <div className="font-medium text-sm">Demo / Mock Mode</div>
                    <div className="text-xs text-zinc-500">Generates fake tracking codes</div>
                  </div>
                </label>
                <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 flex-1">
                  <input
                    type="radio"
                    name="mode"
                    value="live"
                    checked={settings.mode === 'live'}
                    onChange={() => setSettings({ ...settings, mode: 'live' })}
                    className="accent-green-600"
                  />
                  <div>
                    <div className="font-medium text-sm">Live Production</div>
                    <div className="text-xs text-zinc-500">Requires Steadfast API Keys</div>
                  </div>
                </label>
              </div>
            </div>

            {settings.mode === 'live' && (
              <div className="space-y-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input 
                    placeholder="Enter Steadfast API Key" 
                    value={settings.apiKey}
                    onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Secret Key</Label>
                  <Input 
                    type="password"
                    placeholder="Enter Steadfast Secret Key" 
                    value={settings.secretKey}
                    onChange={(e) => setSettings({ ...settings, secretKey: e.target.value })}
                  />
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button 
              onClick={handleSaveSettings} 
              disabled={isSavingSettings} 
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isSavingSettings && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </Button>
          </CardFooter>
        </Card>
      )}

      {activeTab === 'zones' && regionsData && (
        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader>
            <CardTitle>Delivery Zones & Charges</CardTitle>
            <CardDescription>
              Manage delivery charges for all zones. Changes will immediately affect checkout.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="flex-1 space-y-1.5">
                <Label>Filter by Division</Label>
                <select
                  className="flex h-10 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:ring-offset-zinc-950 dark:placeholder:text-zinc-400 dark:focus:ring-zinc-300"
                  value={selectedDivisionId}
                  onChange={(e) => {
                    setSelectedDivisionId(e.target.value);
                    setSelectedDistrictId('');
                  }}
                >
                  <option value="">All Divisions</option>
                  {regionsData.divisions.map(div => (
                    <option key={div.id} value={div.id}>{div.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Filter by District</Label>
                <select
                  className="flex h-10 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:ring-offset-zinc-950 dark:placeholder:text-zinc-400 dark:focus:ring-zinc-300"
                  value={selectedDistrictId}
                  onChange={(e) => setSelectedDistrictId(e.target.value)}
                  disabled={!selectedDivisionId}
                >
                  <option value="">All Districts</option>
                  {regionsData.districts
                    .filter(d => !selectedDivisionId || d.divisionId === selectedDivisionId)
                    .map(dist => (
                    <option key={dist.id} value={dist.id}>{dist.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-zinc-50 dark:bg-zinc-900 border-b dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Zone</th>
                    <th className="px-4 py-3 font-medium">District</th>
                    <th className="px-4 py-3 font-medium">Home Delivery Charge (৳)</th>
                    <th className="px-4 py-3 font-medium">Branch Pickup Charge (৳)</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {regionsData.zones
                    .filter((zone) => {
                      const district = regionsData.districts.find(d => d.id === zone.districtId);
                      if (!district) return false;
                      if (selectedDivisionId && district.divisionId !== selectedDivisionId) return false;
                      if (selectedDistrictId && district.id !== selectedDistrictId) return false;
                      return true;
                    })
                    .map((zone) => {
                    const isEditing = editingZoneId === zone.id;
                    const district = regionsData.districts.find(d => d.id === zone.districtId);
                    
                    return (
                      <tr key={zone.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="px-4 py-3 font-medium">{zone.name}</td>
                        <td className="px-4 py-3 text-zinc-500">{district?.name || 'Unknown'}</td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <Input 
                              type="number" 
                              className="w-24 h-8"
                              value={editCharges.homeDeliveryCharge}
                              onChange={(e) => setEditCharges({...editCharges, homeDeliveryCharge: e.target.value})}
                            />
                          ) : (
                            <span>{zone.homeDeliveryCharge}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <Input 
                              type="number" 
                              className="w-24 h-8"
                              value={editCharges.branchPickupCharge}
                              onChange={(e) => setEditCharges({...editCharges, branchPickupCharge: e.target.value})}
                            />
                          ) : (
                            <span>{zone.branchPickupCharge}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setEditingZoneId(null)}>Cancel</Button>
                              <Button 
                                size="sm" 
                                className="bg-green-600 text-white" 
                                onClick={() => handleSaveZone(zone.id)}
                                disabled={isSavingZone}
                              >
                                {isSavingZone ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                              </Button>
                            </div>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => handleEditZone(zone)}>
                              Edit Charges
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
