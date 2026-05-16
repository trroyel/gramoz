import { Server, Zap, Shield, Smartphone } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const featuresData = [
  {
    title: "Lightweight & Fast",
    description: "Built for speed. Works smoothly even on slower rural networks.",
    icon: Zap,
    color: "text-orange-500",
    bg: "bg-orange-100 dark:bg-orange-900/20",
  },
  {
    title: "Cloud-Based Platform",
    description: "Access your business data anytime, anywhere without localized servers.",
    icon: Server,
    color: "text-green-600",
    bg: "bg-green-100 dark:bg-green-900/20",
  },
  {
    title: "Mobile First Design",
    description: "Fully optimized for smartphone usage, empowering entrepreneurs on the go.",
    icon: Smartphone,
    color: "text-blue-500",
    bg: "bg-blue-100 dark:bg-blue-900/20",
  },
  {
    title: "Secure & Reliable",
    description: "Enterprise-grade security using modern encryption for your peace of mind.",
    icon: Shield,
    color: "text-purple-500",
    bg: "bg-purple-100 dark:bg-purple-900/20",
  },
];

export function Features() {
  return (
    <section className="py-20 bg-zinc-50 dark:bg-zinc-950/50">
      <div className="container px-4 mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-4">
            Why Choose Gramoz?
          </h2>
          <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
            Our platform is specifically tailored for rural product entrepreneurs in Bangladesh, combining simplicity with powerful enterprise tools.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {featuresData.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <Card key={idx} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${feature.bg}`}>
                    <Icon className={`w-6 h-6 ${feature.color}`} />
                  </div>
                  <CardTitle className="text-xl mb-2">{feature.title}</CardTitle>
                  <CardDescription className="text-base">
                    {feature.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
