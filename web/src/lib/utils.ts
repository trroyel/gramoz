import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getImageUrl(images?: (string | { url?: string } | any)[]): string {
  if (!images || images.length === 0) return "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80";
  
  const imgObj = images[0];
  const url = typeof imgObj === 'string' ? imgObj : imgObj?.url;
  
  if (!url || typeof url !== 'string') return "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80";
  if (url.startsWith("http")) return url;
  return url.startsWith("/uploads") ? `/public${url}` : url;
}
