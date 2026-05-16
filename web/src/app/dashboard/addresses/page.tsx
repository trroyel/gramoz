"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AddressesPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Saved Addresses
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            Manage your delivery and billing locations.
          </p>
        </div>
        <Button className="bg-green-600 hover:bg-green-700">
          <Plus className="w-4 h-4 mr-2" />
          Add New Address
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-dashed border-2 hover:bg-muted/50 transition-colors cursor-pointer flex flex-col items-center justify-center min-h-[200px]">
          <CardContent className="flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="p-4 bg-muted rounded-full">
              <MapPin className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No addresses saved</p>
              <p className="text-sm text-muted-foreground">Add an address for faster checkout</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
