import Image from "next/image";
import constructionImg from "@/assets/construction.jpg";

interface UnderConstructionProps {
  title?: string;
  description?: string;
}

export function UnderConstruction({ 
  title = "Coming Soon", 
  description = "We are currently working hard on this feature. It will be available shortly!" 
}: UnderConstructionProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center min-h-[60vh]">
      <div className="relative w-full md:w-2/3 max-w-5xl aspect-video mb-8 overflow-hidden rounded-2xl shadow-lg border dark:border-zinc-800">
        <Image 
          src={constructionImg} 
          alt="Under Construction" 
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 66vw"
          priority
        />
      </div>
      <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-3">
        {title}
      </h2>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
        {description}
      </p>
    </div>
  );
}
