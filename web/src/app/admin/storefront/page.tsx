"use client";

import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Loader2, Save, Image as ImageIcon, LayoutTemplate } from "lucide-react";
import { settingsApi } from "@/lib/api/settings";
import { getImageUrl } from "@/lib/utils";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AdminStorefrontPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [heroTagline, setHeroTagline] = useState("");
  const [heroButtonText, setHeroButtonText] = useState("");
  const [heroButtonLink, setHeroButtonLink] = useState("");
  const [heroImage, setHeroImage] = useState<File | null>(null);
  const [heroImagePreview, setHeroImagePreview] = useState("");
  
  const [promoTitle, setPromoTitle] = useState("");
  const [promoSubtitle, setPromoSubtitle] = useState("");
  const [promoButtonText, setPromoButtonText] = useState("");
  const [promoButtonLink, setPromoButtonLink] = useState("");
  const [promoImage, setPromoImage] = useState<File | null>(null);
  const [promoImagePreview, setPromoImagePreview] = useState("");
  
  const heroFileRef = useRef<HTMLInputElement>(null);
  const promoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchStorefront();
  }, []);

  const fetchStorefront = async () => {
    try {
      const res = await settingsApi.getStorefront();
      if (res.success && res.data) {
        const { hero, promo } = res.data;
        
        if (hero) {
          setHeroTitle(hero.title || "");
          setHeroSubtitle(hero.subtitle || "");
          setHeroTagline(hero.tagline || "");
          setHeroButtonText(hero.buttonText || "");
          setHeroButtonLink(hero.buttonLink || "");
          setHeroImagePreview(getImageUrl(hero.image) || "");
        }
        
        if (promo) {
          setPromoTitle(promo.title || "");
          setPromoSubtitle(promo.subtitle || "");
          setPromoButtonText(promo.buttonText || "");
          setPromoButtonLink(promo.buttonLink || "");
          setPromoImagePreview(getImageUrl(promo.image) || "");
        }
      }
    } catch (error) {
      toast.error("Failed to load storefront configuration");
    } finally {
      setIsLoading(false);
    }
  };

  const handleHeroImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setHeroImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setHeroImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePromoImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPromoImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPromoImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let finalHeroImageUrl = heroImagePreview;
      let finalPromoImageUrl = promoImagePreview;
      
      // Upload new Hero Image if selected
      if (heroImage) {
        const uploadRes = await settingsApi.uploadImage(heroImage);
        if (uploadRes.success) {
          finalHeroImageUrl = uploadRes.url;
        }
      }
      
      // Upload new Promo Image if selected
      if (promoImage) {
        const uploadRes = await settingsApi.uploadImage(promoImage);
        if (uploadRes.success) {
          finalPromoImageUrl = uploadRes.url;
        }
      }

      const payload = {
        hero: {
          title: heroTitle,
          subtitle: heroSubtitle,
          tagline: heroTagline,
          buttonText: heroButtonText,
          buttonLink: heroButtonLink,
          image: finalHeroImageUrl,
        },
        promo: {
          title: promoTitle,
          subtitle: promoSubtitle,
          buttonText: promoButtonText,
          buttonLink: promoButtonLink,
          image: finalPromoImageUrl,
        }
      };

      const res = await settingsApi.updateStorefront(payload);
      if (res.success) {
        toast.success("Storefront configuration saved successfully!");
      }
    } catch (error: any) {
      toast.error("Failed to save storefront configuration", {
        description: error.message
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="container px-4 py-8 mx-auto max-w-5xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <LayoutTemplate className="w-8 h-8 text-blue-600" />
            Storefront CMS
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            Manage the content, banners, and layouts of your homepage
          </p>
        </div>
        <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
          {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>
      </div>

      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Hero Section</CardTitle>
            <CardDescription>The main banner shown at the top of the homepage.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Tagline</Label>
                  <Input value={heroTagline} onChange={(e) => setHeroTagline(e.target.value)} placeholder="e.g. Fresh Arrivals Every Week" />
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} placeholder="e.g. Authentic Rural Products" />
                </div>
                <div className="space-y-2">
                  <Label>Subtitle / Description</Label>
                  <Input value={heroSubtitle} onChange={(e) => setHeroSubtitle(e.target.value)} placeholder="e.g. Discover high-quality, handcrafted goods" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Button Text</Label>
                    <Input value={heroButtonText} onChange={(e) => setHeroButtonText(e.target.value)} placeholder="e.g. Shop Now" />
                  </div>
                  <div className="space-y-2">
                    <Label>Button Link</Label>
                    <Input value={heroButtonLink} onChange={(e) => setHeroButtonLink(e.target.value)} placeholder="e.g. /products" />
                  </div>
                </div>
              </div>
              
              <div className="space-y-2 flex flex-col">
                <Label>Hero Background Image</Label>
                <div 
                  className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col items-center justify-center flex-1 min-h-[250px] cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 overflow-hidden relative"
                  onClick={() => heroFileRef.current?.click()}
                >
                  {heroImagePreview ? (
                    <img src={heroImagePreview} alt="Hero Preview" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-zinc-500">
                      <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>Click to upload image</p>
                    </div>
                  )}
                  <input type="file" ref={heroFileRef} className="hidden" accept="image/*" onChange={handleHeroImageChange} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Promo Banner Section</CardTitle>
            <CardDescription>The promotional banner shown near the bottom of the homepage.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} placeholder="e.g. Get 15% Off Your First Order" />
                </div>
                <div className="space-y-2">
                  <Label>Subtitle / Description</Label>
                  <Input value={promoSubtitle} onChange={(e) => setPromoSubtitle(e.target.value)} placeholder="e.g. Join Gramoz today..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Button Text</Label>
                    <Input value={promoButtonText} onChange={(e) => setPromoButtonText(e.target.value)} placeholder="e.g. View Offers" />
                  </div>
                  <div className="space-y-2">
                    <Label>Button Link</Label>
                    <Input value={promoButtonLink} onChange={(e) => setPromoButtonLink(e.target.value)} placeholder="e.g. /offers" />
                  </div>
                </div>
              </div>
              
              <div className="space-y-2 flex flex-col">
                <Label>Promo Image (Transparent PNG recommended)</Label>
                <div 
                  className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col items-center justify-center flex-1 min-h-[250px] cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 overflow-hidden relative"
                  onClick={() => promoFileRef.current?.click()}
                >
                  {promoImagePreview ? (
                    <img src={promoImagePreview} alt="Promo Preview" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-zinc-500">
                      <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>Click to upload image</p>
                    </div>
                  )}
                  <input type="file" ref={promoFileRef} className="hidden" accept="image/*" onChange={handlePromoImageChange} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
