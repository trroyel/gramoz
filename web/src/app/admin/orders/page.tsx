"use client";

import { useEffect, useState } from "react";
import { Loader2, Package, Eye, X, MapPin, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ordersApi } from "@/lib/api/orders";
import { toast } from "sonner";


export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const fetchOrders = async () => {
    try {
      const response = await ordersApi.getAllAsAdmin();
      if (response.success && response.data) {
        setOrders(response.data);
      }
    } catch (error) {
      console.error("Failed to fetch orders:", error);
      toast.error("Failed to load orders");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    try {
      const response = await ordersApi.updateStatus(orderId, newStatus);
      if (response.success) {
        toast.success("Order status updated successfully");
        setOrders(orders.map(order => 
          order.id === orderId ? { ...order, status: newStatus } : order
        ));
      } else {
        toast.error("Failed to update status");
      }
    } catch (error) {
      toast.error("Error updating order status");
    }
  };

  const openOrderDetails = async (orderId: string) => {
    setIsModalOpen(true);
    setIsLoadingDetails(true);
    try {
      const response = await ordersApi.getAdminOrder(orderId);
      if (response.success && response.data) {
        setSelectedOrder(response.data);
      }
    } catch (error) {
      toast.error("Failed to fetch order details");
      setIsModalOpen(false);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  return (
    <div className="container px-4 py-8 mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Orders Management
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            View and manage all customer orders
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center items-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center p-12 text-zinc-500">
            <Package className="w-12 h-12 mx-auto mb-4 text-zinc-400" />
            <p>No orders found in the system.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-6 py-4 font-medium">Order ID</th>
                  <th className="px-6 py-4 font-medium">Customer</th>
                  <th className="px-6 py-4 font-medium">Date</th>
                  <th className="px-6 py-4 font-medium">Total</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-zinc-900 dark:text-zinc-100">
                      {order.id}
                    </td>
                    <td className="px-6 py-4">
                      {order.customerName || "Unknown Customer"}
                    </td>
                    <td className="px-6 py-4 text-zinc-500">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 font-medium text-zinc-900 dark:text-zinc-100">
                      ৳{order.totalAmount}
                    </td>
                    <td className="px-6 py-4">
                      <select
                        className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm rounded-lg focus:ring-green-500 focus:border-green-500 block w-[140px] p-2"
                        value={order.status}
                        onChange={(e) => handleStatusChange(order.id, e.target.value)}
                        disabled={isLoading}
                      >
                        <option value="pending">Pending</option>
                        <option value="processing">Processing</option>
                        <option value="shipped">Shipped</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="sm" onClick={() => openOrderDetails(order.id)}>
                        <Eye className="w-4 h-4 mr-2" />
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Details Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="text-xl font-semibold">Order Details</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              {isLoadingDetails ? (
                <div className="flex justify-center items-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-green-600" />
                </div>
              ) : selectedOrder ? (
                <div className="space-y-6">
                  {/* Customer & Shipping Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-lg border border-zinc-100 dark:border-zinc-800">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Customer Info</h3>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{selectedOrder.customerName}</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{selectedOrder.customerEmail}</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{selectedOrder.customerPhone || 'No phone provided'}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center gap-2">
                        <MapPin className="w-4 h-4" /> Shipping Address
                      </h3>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{selectedOrder.addressLine1}</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{selectedOrder.city}</p>
                    </div>
                  </div>

                  {/* Fulfillment Info */}
                  {selectedOrder.consignmentId && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-900/30">
                      <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
                        <Truck className="w-4 h-4" /> Tracking Information
                      </h3>
                      <p className="text-sm text-blue-800 dark:text-blue-200">
                        <span className="font-medium">Consignment ID:</span> {selectedOrder.consignmentId}
                      </p>
                      <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">
                        <span className="font-medium">Tracking URL:</span>{' '}
                        <a href={selectedOrder.trackingUrl} target="_blank" rel="noreferrer" className="underline hover:text-blue-600">
                          {selectedOrder.trackingUrl}
                        </a>
                      </p>
                    </div>
                  )}

                  {/* Order Items */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Items</h3>
                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-zinc-50 dark:bg-zinc-900">
                          <tr>
                            <th className="px-4 py-3 font-medium">Product</th>
                            <th className="px-4 py-3 font-medium text-center">Qty</th>
                            <th className="px-4 py-3 font-medium text-right">Price</th>
                            <th className="px-4 py-3 font-medium text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                          {selectedOrder.items?.map((item: any) => (
                            <tr key={item.id}>
                              <td className="px-4 py-3">{item.productName}</td>
                              <td className="px-4 py-3 text-center">{item.quantity}</td>
                              <td className="px-4 py-3 text-right">৳{item.unitPrice}</td>
                              <td className="px-4 py-3 text-right font-medium">
                                ৳{(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-zinc-50 dark:bg-zinc-900">
                          <tr>
                            <td colSpan={3} className="px-4 py-3 text-right font-semibold">Grand Total:</td>
                            <td className="px-4 py-3 text-right font-bold text-green-600 dark:text-green-500">
                              ৳{selectedOrder.totalAmount}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-red-500">
                  Failed to load order details.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
