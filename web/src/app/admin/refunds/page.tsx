"use client";

import { useState, useEffect } from "react";
import { Refund } from "@/types";
import { refundsApi } from "@/lib/api/refunds";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, ArrowRightLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function AdminRefundsPage() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Modal State
  const [selectedRefund, setSelectedRefund] = useState<Refund | null>(null);
  const [actionType, setActionType] = useState<'processed' | 'rejected' | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [gatewayRefundId, setGatewayRefundId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchRefunds = async () => {
    try {
      const res = await refundsApi.getAllAdminRefunds();
      if (res.success && res.data) {
        setRefunds(res.data);
      }
    } catch (err: any) {
      toast.error("Failed to load refunds");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRefunds();
  }, []);

  const openActionModal = (refund: Refund, type: 'processed' | 'rejected') => {
    setSelectedRefund(refund);
    setActionType(type);
    setAdminNotes("");
    setGatewayRefundId("");
  };

  const handleProcessAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRefund || !actionType) return;

    setIsSubmitting(true);
    try {
      const res = await refundsApi.updateRefundStatus(selectedRefund.id, {
        status: actionType,
        adminNotes: adminNotes || undefined,
        gatewayRefundId: gatewayRefundId || undefined,
      });

      if (res.success) {
        toast.success(`Refund ${actionType} successfully`);
        // Update local state
        setRefunds(refunds.map(r => r.id === selectedRefund.id ? { ...r, status: actionType, adminNotes, gatewayRefundId } : r));
        setSelectedRefund(null);
      }
    } catch (err: any) {
      toast.error(err.message || `Failed to ${actionType} refund`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatReason = (reason: string) => {
    return reason.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Refund Management</h1>
        <p className="text-muted-foreground mt-2">Process and review customer refund requests.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Refund Requests</CardTitle>
          <CardDescription>Review requests carefully. Once marked processed, the associated order payment status will automatically update.</CardDescription>
        </CardHeader>
        <CardContent>
          {refunds.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">No refund requests found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Order Info</TableHead>
                  <TableHead>Refund Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refunds.map((refund) => (
                  <TableRow key={refund.id}>
                    <TableCell>
                      <div className="font-medium">{refund.customerName || "Unknown"}</div>
                      <div className="text-xs text-muted-foreground">{refund.customerEmail || "N/A"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{refund.orderId}</div>
                      <div className="text-xs text-muted-foreground">Total: ৳{Number(refund.orderTotal).toFixed(2)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-bold text-red-600">৳{Number(refund.amount).toFixed(2)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{formatReason(refund.reason)}</div>
                      {refund.notes && (
                        <div className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]" title={refund.notes}>
                          Note: {refund.notes}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full capitalize
                        ${refund.status === 'processed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
                        ${refund.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : ''}
                        ${refund.status === 'requested' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''}
                      `}>
                        {refund.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {refund.status === 'requested' ? (
                        <div className="flex justify-end gap-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                            onClick={() => openActionModal(refund, 'processed')}
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1" /> Process
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                            onClick={() => openActionModal(refund, 'rejected')}
                          >
                            <XCircle className="w-4 h-4 mr-1" /> Reject
                          </Button>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          {refund.status === 'processed' && refund.gatewayRefundId ? (
                            <span title={refund.gatewayRefundId} className="flex items-center justify-end gap-1">
                              <ArrowRightLeft className="w-3 h-3" /> Refunded
                            </span>
                          ) : (
                            <span className="capitalize">{refund.status}</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Action Modal */}
      <Dialog open={!!selectedRefund} onOpenChange={(open) => !open && setSelectedRefund(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className={actionType === 'processed' ? 'text-green-600' : 'text-red-600'}>
              {actionType === 'processed' ? 'Process Refund' : 'Reject Refund'}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'processed' 
                ? `You are about to process a refund of ৳${Number(selectedRefund?.amount).toFixed(2)} for ${selectedRefund?.customerName}.`
                : `You are about to reject the refund request for ${selectedRefund?.customerName}.`
              }
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleProcessAction} className="space-y-4 mt-2">
            
            {actionType === 'processed' && (
              <div>
                <label className="block text-sm font-medium mb-1">Gateway Transaction ID (Optional)</label>
                <Input
                  placeholder="e.g. re_3M..."
                  value={gatewayRefundId}
                  onChange={(e) => setGatewayRefundId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">For tracking the refund in Stripe/SSLCommerz.</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Admin Notes (Optional)</label>
              <Textarea
                placeholder={actionType === 'rejected' ? "Reason for rejection..." : "Internal notes..."}
                rows={3}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                required={actionType === 'rejected'}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setSelectedRefund(null)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                className={actionType === 'processed' ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Saving..." : "Confirm"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
