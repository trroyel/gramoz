"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { MapPin, Plus, Loader2, Home, Building, Pencil, Trash2, Check, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Address } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  useAddresses, 
  useCreateAddress, 
  useUpdateAddress, 
  useDeleteAddress, 
  useSetDefaultAddress 
} from "@/hooks/queries/use-addresses";

export default function AddressesPage() {
  const { data: addresses = [], isLoading } = useAddresses();
  const createAddress = useCreateAddress();
  const updateAddress = useUpdateAddress();
  const deleteAddress = useDeleteAddress();
  const setDefaultAddress = useSetDefaultAddress();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    title: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    zipCode: "",
    isDefault: false,
  });

  const handleCreateAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateAddress.mutate({ id: editingId, data: formData }, {
        onSuccess: () => closeAndResetModal()
      });
    } else {
      createAddress.mutate(formData, {
        onSuccess: () => closeAndResetModal()
      });
    }
  };

  const closeAndResetModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({
      title: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      zipCode: "",
      isDefault: false,
    });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this address?")) return;
    deleteAddress.mutate(id);
  };

  const handleSetDefault = async (id: string) => {
    setDefaultAddress.mutate(id);
  };

  const openEditModal = (address: Address) => {
    setEditingId(address.id);
    setFormData({
      title: address.title || "",
      addressLine1: address.addressLine1 || "",
      addressLine2: address.addressLine2 || "",
      city: address.city || "",
      zipCode: address.zipCode || "",
      isDefault: address.isDefault || false,
    });
    setIsModalOpen(true);
  };

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({
      title: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      zipCode: "",
      isDefault: false,
    });
    setIsModalOpen(true);
  };
  
  const isSubmitting = createAddress.isPending || updateAddress.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Saved Addresses
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            Manage your delivery and billing locations.
          </p>
        </div>
        <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={openCreateModal}>
          <Plus className="w-4 h-4 mr-2" />
          Add New Address
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-green-600" />
        </div>
      ) : addresses.length === 0 ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card 
            onClick={openCreateModal}
            className="border-dashed border-2 hover:bg-muted/50 transition-colors cursor-pointer flex flex-col items-center justify-center min-h-[200px]"
          >
            <CardContent className="flex flex-col items-center justify-center p-6 text-center space-y-4">
              <div className="p-4 bg-muted rounded-full">
                <MapPin className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No addresses saved</p>
                <p className="text-sm text-muted-foreground">Add an address for faster checkout</p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {addresses.map((address) => (
            <Card key={address.id} className={`overflow-hidden transition-all ${address.isDefault ? 'border-green-500 shadow-sm' : ''}`}>
              <CardHeader className="bg-muted/30 pb-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    {address.title.toLowerCase().includes('home') ? (
                      <Home className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <Building className="w-5 h-5 text-muted-foreground" />
                    )}
                    <CardTitle className="text-lg">{address.title}</CardTitle>
                    {address.isDefault && (
                      <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ml-2">
                        <Star className="w-3 h-3 fill-current" /> Default
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="text-foreground font-medium">{address.addressLine1}</p>
                  {address.addressLine2 && <p>{address.addressLine2}</p>}
                  <p>{address.city}{address.zipCode ? `, ${address.zipCode}` : ''}</p>
                </div>
              </CardContent>
              <CardFooter className="bg-muted/10 border-t pt-4 flex justify-between">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  disabled={address.isDefault}
                  onClick={() => handleSetDefault(address.id)}
                  className={address.isDefault ? "text-muted-foreground" : "text-green-600 hover:text-green-700 hover:bg-green-50"}
                >
                  <Check className="w-4 h-4" />
                  {address.isDefault ? "Default Address" : "Set as Default"}
                </Button>
                <div className="flex space-x-2">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-zinc-600 hover:text-blue-600 hover:bg-blue-50 dark:text-zinc-400 dark:hover:text-blue-400 dark:hover:bg-blue-900/20"
                    onClick={() => openEditModal(address)}
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => handleDelete(address.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                    Remove
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}

          <Card 
            onClick={openCreateModal}
            className="border-dashed border-2 hover:bg-muted/50 transition-colors cursor-pointer flex flex-col items-center justify-center min-h-[200px]"
          >
            <CardContent className="flex flex-col items-center justify-center p-6 text-center space-y-4">
              <div className="p-4 bg-muted rounded-full">
                <Plus className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Add another address</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create Address Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-[500px] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h2 className="text-xl font-semibold">{editingId ? 'Edit Address' : 'Add New Address'}</h2>
                <p className="text-sm text-zinc-500 mt-1">
                  {editingId ? 'Update your delivery address details below.' : 'Enter your delivery address details below.'}
                </p>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[70vh]">
              <form onSubmit={handleCreateAddress} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Address Title (e.g., Home, Office)</Label>
                  <Input 
                    id="title" 
                    placeholder="Home" 
                    required 
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addressLine1">Address Line 1</Label>
                  <Input 
                    id="addressLine1" 
                    placeholder="Street address, house number" 
                    required 
                    value={formData.addressLine1}
                    onChange={(e) => setFormData({...formData, addressLine1: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addressLine2">Address Line 2 (Optional)</Label>
                  <Input 
                    id="addressLine2" 
                    placeholder="Apartment, suite, unit, etc." 
                    value={formData.addressLine2}
                    onChange={(e) => setFormData({...formData, addressLine2: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input 
                      id="city" 
                      placeholder="Dhaka" 
                      required 
                      value={formData.city}
                      onChange={(e) => setFormData({...formData, city: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zipCode">Zip/Postal Code (Optional)</Label>
                    <Input 
                      id="zipCode" 
                      placeholder="1200" 
                      value={formData.zipCode}
                      onChange={(e) => setFormData({...formData, zipCode: e.target.value})}
                    />
                  </div>
                </div>
                
                <div className="flex items-center space-x-2 pt-2">
                  <input 
                    type="checkbox" 
                    id="isDefault" 
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({...formData, isDefault: e.target.checked})}
                  />
                  <Label htmlFor="isDefault" className="cursor-pointer">Set as default address</Label>
                </div>

                <div className="flex justify-end gap-3 pt-6 mt-4 border-t border-zinc-200 dark:border-zinc-800">
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                  <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {editingId ? 'Update Address' : 'Save Address'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
