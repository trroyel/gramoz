"use client";

import { useEffect, useState } from "react";
import { promosApi, type Promo } from "@/lib/api/promos";
import { Plus, Tag, Trash2, Edit2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PromosManagementPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    code: "",
    discountType: "percentage" as "percentage" | "fixed",
    discountValue: "",
    minOrderValue: "",
    maxUses: "",
    expiresAt: "",
  });

  const fetchPromos = async () => {
    try {
      setIsLoading(true);
      const data = await promosApi.getAllPromos();
      setPromos(data);
    } catch (err: any) {
      setError(err.message || "Failed to load promos");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPromos();
  }, []);

  const handleToggleActive = async (id: string) => {
    try {
      await promosApi.togglePromoActive(id);
      fetchPromos();
    } catch (err: any) {
      alert(err.message || "Failed to toggle promo");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this promo code?")) return;
    try {
      await promosApi.deletePromo(id);
      fetchPromos();
    } catch (err: any) {
      alert(err.message || "Failed to delete promo");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await promosApi.createPromo({
        code: formData.code,
        discountType: formData.discountType,
        discountValue: Number(formData.discountValue),
        minOrderValue: formData.minOrderValue ? Number(formData.minOrderValue) : undefined,
        maxUses: formData.maxUses ? Number(formData.maxUses) : undefined,
        expiresAt: formData.expiresAt ? new Date(formData.expiresAt).toISOString() : undefined,
      });
      setIsModalOpen(false);
      setFormData({
        code: "",
        discountType: "percentage",
        discountValue: "",
        minOrderValue: "",
        maxUses: "",
        expiresAt: "",
      });
      fetchPromos();
    } catch (err: any) {
      alert(err.message || "Failed to create promo");
    }
  };

  if (isLoading && promos.length === 0) {
    return <div className="p-8 text-center text-zinc-500">Loading promos...</div>;
  }

  return (
    <div className="container px-4 py-8 mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <Tag className="w-6 h-6 text-green-600" />
            Promo Codes
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">
            Manage promotional discounts and coupons for your customers.
          </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white">
          <Plus className="w-4 h-4" />
          Create Promo
        </Button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl flex items-center gap-2 border border-red-100">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-zinc-950 border dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900 border-b dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 text-sm">
                <th className="px-6 py-4 font-medium whitespace-nowrap">Code</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">Discount</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">Usage</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">Limits</th>
                <th className="px-6 py-4 font-medium whitespace-nowrap">Status</th>
                <th className="px-6 py-4 font-medium text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {promos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-zinc-500">
                    No promo codes found. Create one to get started!
                  </td>
                </tr>
              ) : (
                promos.map((promo) => (
                  <tr key={promo.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono font-medium text-sm tracking-wider">
                        {promo.code}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {promo.discountType === 'percentage' 
                          ? `${promo.discountValue}% OFF` 
                          : `${promo.discountValue} ৳ OFF`}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        <span className="font-medium">{promo.currentUses}</span>
                        <span className="text-zinc-500">
                          {promo.maxUses ? ` / ${promo.maxUses}` : ' (Unlimited)'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-zinc-500">
                        {promo.minOrderValue ? `Min ${promo.minOrderValue} ৳` : 'No min order'}
                        <br />
                        {promo.expiresAt ? `Exp: ${new Date(promo.expiresAt).toLocaleDateString()}` : 'No expiry'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleToggleActive(promo.id)}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          promo.isActive
                            ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                            : "bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200"
                        }`}
                      >
                        {promo.isActive ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDelete(promo.id)}
                        className="p-2 text-zinc-400 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50"
                        title="Delete Promo"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Promo Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-950 w-full max-w-md rounded-2xl shadow-xl border dark:border-zinc-800 overflow-hidden">
            <div className="p-6 border-b dark:border-zinc-800">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Create Promo Code</h2>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Code</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. SUMMER20"
                  className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-green-500 focus:outline-none uppercase font-mono"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Type</label>
                  <select
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-green-500 focus:outline-none"
                    value={formData.discountType}
                    onChange={(e) => setFormData({ ...formData, discountType: e.target.value as any })}
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed Amount (৳)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Value</label>
                  <input
                    required
                    type="number"
                    min="0"
                    step={formData.discountType === 'percentage' ? "1" : "0.01"}
                    max={formData.discountType === 'percentage' ? "100" : undefined}
                    placeholder="e.g. 20"
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-green-500 focus:outline-none"
                    value={formData.discountValue}
                    onChange={(e) => setFormData({ ...formData, discountValue: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Min. Order Value (Optional)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 500"
                  className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-green-500 focus:outline-none"
                  value={formData.minOrderValue}
                  onChange={(e) => setFormData({ ...formData, minOrderValue: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Max Uses (Optional)</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g. 100"
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-green-500 focus:outline-none"
                    value={formData.maxUses}
                    onChange={(e) => setFormData({ ...formData, maxUses: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Expires At (Optional)</label>
                  <input
                    type="date"
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border dark:border-zinc-800 rounded-xl focus:ring-2 focus:ring-green-500 focus:outline-none"
                    value={formData.expiresAt}
                    onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 mt-2 border-t dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors font-medium"
                >
                  Cancel
                </button>
                <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white rounded-xl px-6 py-2 font-medium">
                  Create Promo
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
