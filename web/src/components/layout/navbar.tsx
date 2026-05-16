"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShoppingBag, User, LogOut, Menu, ShoppingCart, LayoutDashboard, ChevronDown, Search, Package, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { useCartStore } from "@/stores/cart-store";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isMounted, setIsMounted] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { isAuthenticated, user, clearAuth } = useAuthStore();
  const cartItems = useCartStore((state) => state.items);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    clearAuth();
    window.location.href = "/";
  };

  const navLinks = [
    { href: "/products", label: "Products" },
    { href: "/offers", label: "Offers" },
    { href: "/about", label: "About" },
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/products?q=${encodeURIComponent(searchQuery)}`);
    } else {
      router.push(`/products`);
    }
  };

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-green-600" />
            <span className="text-xl font-bold">Gramoz</span>
            <span className="text-sm text-muted-foreground">গ্রামজ</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-primary",
                  pathname === link.href
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Search Box */}
          <div className="hidden md:flex flex-1 max-w-sm mx-6">
            <form onSubmit={handleSearch} className="w-full relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-100 dark:bg-zinc-900 border-transparent focus:border-green-600 focus:bg-white dark:focus:bg-zinc-950 focus:ring-1 focus:ring-green-600 rounded-md pl-9 pr-4 py-2 text-sm outline-none transition-all placeholder:text-zinc-500"
              />
            </form>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <ThemeToggle />

            {/* Cart Button */}
            <Button variant="ghost" size="icon" className="relative" asChild>
              <Link href="/cart">
                <ShoppingCart className="h-5 w-5" />
                {isMounted && cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </Link>
            </Button>

            {isAuthenticated ? (
              <div className="relative" ref={dropdownRef}>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="gap-2"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                  <User className="h-4 w-4" />
                  <span className="hidden sm:inline max-w-[100px] truncate">{user?.fullName || "Account"}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>

                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-zinc-950 border dark:border-zinc-800 rounded-lg shadow-lg py-1 overflow-hidden z-50">
                    <div className="px-4 py-2 border-b dark:border-zinc-800 mb-1">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{user?.fullName || "Customer"}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{user?.email}</p>
                    </div>
                    <Link 
                      href="/dashboard" 
                      className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                      onClick={() => setIsDropdownOpen(false)}
                    >
                      <LayoutDashboard className="h-4 w-4" /> Dashboard
                    </Link>
                    <Link 
                      href="/dashboard/profile" 
                      className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                      onClick={() => setIsDropdownOpen(false)}
                    >
                      <User className="h-4 w-4" /> Profile
                    </Link>
                    <Link 
                      href="/dashboard/orders" 
                      className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                      onClick={() => setIsDropdownOpen(false)}
                    >
                      <Package className="h-4 w-4" /> Orders
                    </Link>
                    <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-1" />
                    <button 
                      onClick={() => { setIsDropdownOpen(false); handleLogout(); }} 
                      className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      <LogOut className="h-4 w-4" /> Logout
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    Login
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="sm" className="bg-green-600 hover:bg-green-700">
                    Sign Up
                  </Button>
                </Link>
              </>
            )}

            {/* Mobile Menu Button */}
            <Button 
              variant="ghost" 
              size="icon" 
              className="md:hidden"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden py-4 border-t dark:border-zinc-800 space-y-4 animate-in slide-in-from-top-2">
            {/* Mobile Search */}
            <form onSubmit={(e) => { handleSearch(e); setIsMobileMenuOpen(false); }} className="relative px-2">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-100 dark:bg-zinc-900 border-transparent focus:border-green-600 focus:bg-white dark:focus:bg-zinc-950 focus:ring-1 focus:ring-green-600 rounded-md pl-9 pr-4 py-2 text-sm outline-none transition-all placeholder:text-zinc-500"
              />
            </form>

            {/* Mobile Navigation Links */}
            <div className="flex flex-col space-y-1 px-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "block px-3 py-2 rounded-md text-base font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900",
                    pathname === link.href
                      ? "text-green-600 dark:text-green-500 bg-green-50 dark:bg-green-900/10"
                      : "text-zinc-600 dark:text-zinc-400"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>
    </nav>
  );
}
