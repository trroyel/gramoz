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
  Activity
} from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { PLATFORM_ROLES } from "@/types";

const sidebarLinks = [
  { name: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { name: "Products", href: "/admin/products", icon: Package },
  { name: "Categories", href: "/admin/categories", icon: FolderTree },
  { name: "Orders", href: "/admin/orders", icon: ShoppingCart },
  { name: "Users", href: "/admin/users", icon: Users },
  { name: "Promos", href: "/admin/promos", icon: Tag },
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
  const { user, logout } = useAuthStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Protect the admin route
  useEffect(() => {
    if (user === undefined) return; // Wait for hydration if undefined
    if (user === null) {
      router.push("/login");
    } else if (user.role && !PLATFORM_ROLES.includes(user.role)) {
      router.push("/");
    }
  }, [user, router]);

  const isPlatformUser = user && user.role && PLATFORM_ROLES.includes(user.role);
  // If there's no user or the user is not a platform user, don't render the layout
  if (!isPlatformUser) return null;

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
