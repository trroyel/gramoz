"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Settings,
  LogOut,
  Menu,
  X,
  User as UserIcon,
  Store,
  Users,
  Tag,
  FolderTree,
  Activity,
  Coins,
  LayoutTemplate,
  MessageSquare,
  RefreshCcw,
  Truck
} from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { authApi } from "@/lib/api/auth";
import { Button } from "@/components/ui/button";
import { PLATFORM_ROLES } from "@/types";

const sidebarLinks = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Storefront CMS", href: "/admin/storefront", icon: LayoutTemplate },
  { name: "Products", href: "/admin/products", icon: Package },
  { name: "Categories", href: "/admin/categories", icon: FolderTree },
  { name: "Orders", href: "/admin/orders", icon: ShoppingCart },
  { name: "Users", href: "/admin/users", icon: Users },
  { name: "Promos", href: "/admin/promos", icon: Tag },
  { name: "Reviews", href: "/admin/reviews", icon: MessageSquare },
  { name: "Refunds", href: "/admin/refunds", icon: RefreshCcw },
  { name: "Loyalty", href: "/admin/settings/loyalty", icon: Coins },
  { name: "Shipping & Courier", href: "/admin/courier", icon: Truck },
  { name: "System", href: "/admin/system", icon: Activity },
  { name: "My Account", href: "/dashboard/profile", icon: UserIcon },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuthStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const [isVerifiedAdmin, setIsVerifiedAdmin] = useState(false);

  // Active cryptographic verification against backend — prevents localStorage tampering
  useEffect(() => {
    let isMounted = true;

    async function verifyAdminSession() {
      try {
        const res = await authApi.getMe();
        if (!isMounted) return;

        if (
          res.success &&
          res.data &&
          res.data.role &&
          PLATFORM_ROLES.includes(res.data.role)
        ) {
          useAuthStore.getState().setUser(res.data);
          setIsVerifiedAdmin(true);
        } else {
          // User is authenticated as customer or unauthorized role
          useAuthStore.getState().clearAuth();
          router.replace("/");
        }
      } catch {
        if (!isMounted) return;
        useAuthStore.getState().clearAuth();
        router.replace("/login");
      } finally {
        if (isMounted) {
          setIsVerifying(false);
        }
      }
    }

    void verifyAdminSession();

    return () => {
      isMounted = false;
    };
  }, [router]);

  // Prevent any rendering of admin layout or child pages while verification is pending
  if (isVerifying || !isVerifiedAdmin) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-zinc-50 dark:bg-black">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-600 border-t-transparent" />
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Verifying administrative credentials...
          </p>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <div className="flex-1 w-full bg-zinc-50 dark:bg-black flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-zinc-950 border-b dark:border-zinc-800">
        <Link href="/admin" className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-zinc-900 dark:text-zinc-50" />
          <span className="font-bold text-xl tracking-tight">Admin Panel</span>
        </Link>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2">
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-zinc-950 border-r dark:border-zinc-800 transform transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0
        ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="h-full flex flex-col">
          <div className="p-6 hidden md:flex items-center gap-3">
            <Settings className="w-6 h-6 text-zinc-900 dark:text-zinc-50" />
            <Link href="/admin" className="font-bold text-2xl tracking-tight text-zinc-900 dark:text-zinc-50">
              Admin Panel
            </Link>
          </div>

          <nav className="flex-1 px-4 pt-2 pb-8 space-y-2">
            {sidebarLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${isActive
                      ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 font-medium"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <Icon className="w-5 h-5" />
                  {link.name}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 w-full relative">
        {/* Overlay for mobile sidebar */}
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
        <div className="p-4 md:p-8 w-full h-full overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
