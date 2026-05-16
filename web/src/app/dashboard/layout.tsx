"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  LogOut, 
  Menu, 
  X, 
  User as UserIcon,
  LayoutDashboard,
  Package,
  MapPin,
  ShoppingBag
} from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";

const sidebarLinks = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "My Orders", href: "/dashboard/orders", icon: Package },
  { name: "Addresses", href: "/dashboard/addresses", icon: MapPin },
  { name: "Profile", href: "/dashboard/profile", icon: UserIcon },
];

export default function CustomerDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Redirect if not logged in
    if (!user) {
      router.push("/login");
    }
  }, [user, router]);

  const handleLogout = () => {
    clearAuth();
    router.push("/login");
  };

  if (!user) return null; // Avoid flashing the layout before redirect

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-zinc-950 border-b dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
            <ShoppingBag className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight">My Account</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2">
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-zinc-950 border-r dark:border-zinc-800 transform transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0 flex flex-col
        ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="h-full flex flex-col">
          <div className="p-6 hidden md:flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                <ShoppingBag className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-zinc-900 dark:text-zinc-50">
                My Account
              </span>
            </div>
          </div>

          <nav className="flex-1 px-4 py-4 md:py-8 space-y-2">
            {sidebarLinks.map((link) => {
              const Icon = link.icon;
              // Strict match for Overview to avoid highlighting it for child routes
              const isActive = link.href === "/dashboard" 
                ? pathname === "/dashboard"
                : pathname === link.href || pathname.startsWith(link.href + '/');

              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                    isActive 
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

          <div className="p-4 border-t dark:border-zinc-800">
            <div className="flex items-center gap-3 p-3 rounded-xl mb-2">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <UserIcon className="w-5 h-5 text-green-600 dark:text-green-500" />
              </div>
              <div className="overflow-hidden">
                <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                  {user?.fullName || "Customer"}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {user?.email || "Customer Account"}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl"
              onClick={handleLogout}
            >
              <LogOut className="w-5 h-5 mr-3" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 w-full relative h-screen overflow-hidden flex flex-col">
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
        <div className="p-4 md:p-8 w-full max-w-7xl mx-auto flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
