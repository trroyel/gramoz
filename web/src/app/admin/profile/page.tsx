"use client";

import { useAuthStore } from "@/stores/auth-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserCircle, Mail, Phone, Calendar, ShieldCheck } from "lucide-react";

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Your Profile
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-2">
          Manage your personal information and store security.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 border-0 shadow-sm flex flex-col items-center justify-center p-8 text-center space-y-4">
          <div className="w-32 h-32 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-2">
            <UserCircle className="w-16 h-16 text-orange-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{user?.fullName || "Entrepreneur"}</h2>
            <p className="text-sm text-zinc-500">{user?.email || "No email"}</p>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-medium border
            ${user?.isEmailVerified 
              ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-900" 
              : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900"}
          `}>
            {user?.isEmailVerified ? "Verified Account" : "Unverified Account"}
          </div>
        </Card>

        <Card className="md:col-span-2 border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Update your basic details to help customers reach you better.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fullName" className="flex items-center gap-2">
                  <UserCircle className="w-4 h-4 text-zinc-500" />
                  Full Name
                </Label>
                <Input id="fullName" defaultValue={user?.fullName || ""} />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-zinc-500" />
                  Email Address
                </Label>
                <Input id="email" type="email" defaultValue={user?.email || ""} disabled />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-zinc-500" />
                  Phone Number
                </Label>
                <Input id="phone" type="tel" defaultValue={user?.phone || ""} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status" className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-zinc-500" />
                  Account Status
                </Label>
                <Input id="status" defaultValue={user?.status || "Active"} disabled />
              </div>
              
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="joined" className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-zinc-500" />
                  Joined at
                </Label>
                <Input id="joined" defaultValue={user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "Just now"} disabled />
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <Button className="bg-green-600 hover:bg-green-700 text-white">
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
