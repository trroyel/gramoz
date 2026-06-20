"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Users, Eye, X, ShieldAlert, ShieldCheck, Ban, CheckCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminUsersApi, AdminUser } from "@/lib/api/admin-users";
import { useDebounce } from "@/hooks/use-debounce";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";

export default function AdminUsersPage() {
  const { user: currentUser } = useAuthStore();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Pagination & Filtering
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 500);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Modal States
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userOrders, setUserOrders] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await adminUsersApi.getUsers({
        page,
        limit: 10,
        query: debouncedSearch,
        role: roleFilter,
        sortBy,
        sortOrder,
      });
      if (response.success && response.data) {
        setUsers(response.data);
        if (response.meta) {
          setTotalPages(response.meta.totalPages);
        }
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
      toast.error("Failed to load users");
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, roleFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Reset page when search or filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (userId === currentUser?.id) {
      toast.error("You cannot change your own role!");
      return;
    }

    if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;

    try {
      const response = await adminUsersApi.updateRole(userId, newRole);
      if (response.success) {
        toast.success(`Role updated to ${newRole}`);
        setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
        if (selectedUser?.id === userId) {
          setSelectedUser({ ...selectedUser, role: newRole });
        }
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to update role");
    }
  };

  const handleStatusChange = async (userId: string, newStatus: string) => {
    if (userId === currentUser?.id) {
      toast.error("You cannot suspend yourself!");
      return;
    }

    const action = newStatus === 'suspended' ? 'Ban' : 'Unban';
    if (!confirm(`Are you sure you want to ${action} this user?`)) return;

    try {
      const response = await adminUsersApi.updateStatus(userId, newStatus);
      if (response.success) {
        toast.success(`User status updated to ${newStatus}`);
        setUsers(users.map(u => u.id === userId ? { ...u, status: newStatus } : u));
        if (selectedUser?.id === userId) {
          setSelectedUser({ ...selectedUser, status: newStatus });
        }
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to update status");
    }
  };

  const openUserDetails = async (user: AdminUser) => {
    setSelectedUser(user);
    setIsModalOpen(true);
    setIsLoadingDetails(true);

    try {
      // Refresh user details to get latest stats
      const [detailsRes, ordersRes] = await Promise.all([
        adminUsersApi.getUserDetails(user.id),
        adminUsersApi.getUserOrders(user.id)
      ]);

      if (detailsRes.success && detailsRes.data) {
        setSelectedUser(detailsRes.data);
      }

      if (ordersRes.success && ordersRes.data) {
        setUserOrders(ordersRes.data);
      }
    } catch (error) {
      toast.error("Failed to fetch full user details");
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  return (
    <div className="container px-4 py-8 mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <Users className="w-8 h-8 text-blue-600" />
            Users Management
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            View and manage all registered customers and administrators
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-full sm:w-[250px]"
            />
          </div>
          <select
            className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm rounded-lg focus:ring-green-500 focus:border-green-500 block p-2"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">All Roles</option>
            <option value="customer">Customers</option>
            <option value="admin">Admins</option>
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {isLoading && users.length === 0 ? (
          <div className="flex justify-center items-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-green-500" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center p-12 text-zinc-500">
            <Users className="w-12 h-12 mx-auto mb-4 text-zinc-400" />
            <p>No users found matching your criteria.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-zinc-500 uppercase bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                <tr>
                  <th className="px-6 py-4 font-medium cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => handleSort('fullName')}>
                    User {sortBy === 'fullName' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-4 font-medium cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => handleSort('role')}>
                    Role {sortBy === 'role' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-4 font-medium cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => handleSort('status')}>
                    Status {sortBy === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-4 font-medium cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => handleSort('totalOrders')}>
                    Orders {sortBy === 'totalOrders' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-4 font-medium cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => handleSort('createdAt')}>
                    Joined {sortBy === 'createdAt' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{user.fullName}</div>
                      <div className="text-xs text-zinc-500">{user.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.role === 'admin'
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                        : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.status === 'active'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        }`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-medium text-zinc-900 dark:text-zinc-100">
                      {user.totalOrders} <span className="text-zinc-500 font-normal text-xs ml-1">(৳{user.totalSpending})</span>
                    </td>
                    <td className="px-6 py-4 text-zinc-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="sm" onClick={() => openUserDetails(user)}>
                        <Eye className="w-4 h-4 mr-2" />
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!isLoading && totalPages > 1 && (
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
            <span className="text-sm text-zinc-500">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* User Details & Actions Modal */}
      {isModalOpen && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h2 className="text-xl font-semibold">User Details</h2>
                <p className="text-sm text-zinc-500">{selectedUser.id}</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {isLoadingDetails ? (
                <div className="flex justify-center items-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-green-600" />
                </div>
              ) : (
                <div className="space-y-6">

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-lg border border-zinc-100 dark:border-zinc-800">
                      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Total Orders</div>
                      <div className="text-2xl font-bold">{selectedUser.totalOrders}</div>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-lg border border-zinc-100 dark:border-zinc-800">
                      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Total Spent</div>
                      <div className="text-2xl font-bold">৳{selectedUser.totalSpending}</div>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-lg border border-zinc-100 dark:border-zinc-800">
                      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Joined</div>
                      <div className="text-lg font-medium">{new Date(selectedUser.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-lg border border-zinc-100 dark:border-zinc-800">
                      <div className="text-zinc-500 text-xs uppercase tracking-wider mb-1">Last Login</div>
                      <div className="text-lg font-medium">{selectedUser.lastLoginAt ? new Date(selectedUser.lastLoginAt).toLocaleDateString() : 'Never'}</div>
                    </div>
                  </div>

                  {/* Profile Info & Admin Actions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold border-b border-zinc-200 dark:border-zinc-800 pb-2">Profile Info</h3>
                      <div>
                        <div className="text-sm text-zinc-500">Full Name</div>
                        <div className="font-medium">{selectedUser.fullName}</div>
                      </div>
                      <div>
                        <div className="text-sm text-zinc-500">Email Address</div>
                        <div className="font-medium">{selectedUser.email}</div>
                      </div>
                      <div>
                        <div className="text-sm text-zinc-500">Phone Number</div>
                        <div className="font-medium">{selectedUser.phone || 'Not provided'}</div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold border-b border-zinc-200 dark:border-zinc-800 pb-2">Admin Actions</h3>

                      <div className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                        <div>
                          <div className="font-medium text-sm">Role Privilege</div>
                          <div className="text-xs text-zinc-500">Currently: <span className="font-bold">{selectedUser.role}</span></div>
                        </div>
                        {selectedUser.role === 'admin' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-orange-600 border-orange-200 hover:bg-orange-50 dark:hover:bg-orange-950"
                            onClick={() => handleRoleChange(selectedUser.id, 'customer')}
                            disabled={selectedUser.id === currentUser?.id}
                          >
                            <ShieldAlert className="w-4 h-4 mr-2" /> Demote to Customer
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-purple-600 border-purple-200 hover:bg-purple-50 dark:hover:bg-purple-950"
                            onClick={() => handleRoleChange(selectedUser.id, 'admin')}
                          >
                            <ShieldCheck className="w-4 h-4 mr-2" /> Promote to Admin
                          </Button>
                        )}
                      </div>

                      <div className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                        <div>
                          <div className="font-medium text-sm">Account Status</div>
                          <div className="text-xs text-zinc-500">Currently: <span className="font-bold">{selectedUser.status}</span></div>
                        </div>
                        {selectedUser.status === 'active' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950"
                            onClick={() => handleStatusChange(selectedUser.id, 'suspended')}
                            disabled={selectedUser.id === currentUser?.id}
                          >
                            <Ban className="w-4 h-4 mr-2" /> Ban User
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-950"
                            onClick={() => handleStatusChange(selectedUser.id, 'active')}
                          >
                            <CheckCircle className="w-4 h-4 mr-2" /> Unban User
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Order History */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 border-b border-zinc-200 dark:border-zinc-800 pb-2">Recent Orders</h3>
                    {userOrders.length === 0 ? (
                      <p className="text-sm text-zinc-500 text-center py-4">No orders placed by this user yet.</p>
                    ) : (
                      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-zinc-50 dark:bg-zinc-900">
                            <tr>
                              <th className="px-4 py-3 font-medium">Order ID</th>
                              <th className="px-4 py-3 font-medium">Date</th>
                              <th className="px-4 py-3 font-medium">Status</th>
                              <th className="px-4 py-3 font-medium text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                            {userOrders.slice(0, 5).map((order: any) => (
                              <tr key={order.id}>
                                <td className="px-4 py-3 font-mono text-xs">{order.id.split('-')[0]}...</td>
                                <td className="px-4 py-3">{new Date(order.createdAt).toLocaleDateString()}</td>
                                <td className="px-4 py-3">
                                  <span className="capitalize text-xs font-medium px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full">{order.status}</span>
                                </td>
                                <td className="px-4 py-3 text-right font-medium">৳{order.totalAmount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {userOrders.length > 5 && (
                          <div className="p-3 text-center text-xs text-zinc-500 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                            Showing 5 of {userOrders.length} orders
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
