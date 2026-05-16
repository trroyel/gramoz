import Image, { ImageProps } from "next/image";
import { cn } from "@/lib/utils";

interface OptimizedImageProps extends Omit<ImageProps, "alt"> {
  alt: string;
  className?: string;
  containerClassName?: string;
}

export function OptimizedImage({
  src,
  alt,
  className,
  containerClassName,
  ...props
}: OptimizedImageProps) {
  // Ensure we have a valid src string
  const imageSrc = typeof src === "string" ? src : "";
  
  return (
    <div className={cn("relative overflow-hidden bg-zinc-100 dark:bg-zinc-800", containerClassName)}>
      <Image
        src={imageSrc || "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=500&q=80"}
        alt={alt}
        loading="lazy"
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        className={cn(
          "object-cover duration-700 ease-in-out",
          className
        )}
        fill
        {...props}
      />
    </div>
  );
}
