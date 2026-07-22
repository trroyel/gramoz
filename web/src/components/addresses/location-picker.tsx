"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix for default Leaflet icon paths in Next.js
const defaultIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface LocationPickerProps {
  initialPosition?: [number, number];
  onLocationSelect: (lat: number, lng: number) => void;
}

// Dhaka default coordinates
const DEFAULT_CENTER: [number, number] = [23.8103, 90.4125];

function MapClickHandler({ onLocationSelect, position }: { onLocationSelect: (lat: number, lng: number) => void, position: [number, number] | null }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });

  return position ? <Marker position={position} icon={defaultIcon} /> : null;
}

export default function LocationPicker({ initialPosition, onLocationSelect }: LocationPickerProps) {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<[number, number] | null>(initialPosition || null);

  useEffect(() => {
    setMounted(true);
    // If the browser supports geolocation and we don't have an initial position, try to get it
    if (!initialPosition && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setPosition(coords);
          onLocationSelect(coords[0], coords[1]);
        },
        () => {
          // Fallback to default center if user denies or error
        }
      );
    }
  }, []);

  const handleLocationSelect = (lat: number, lng: number) => {
    setPosition([lat, lng]);
    onLocationSelect(lat, lng);
  };

  if (!mounted) {
    return (
      <div className="w-full h-[300px] bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-xl flex items-center justify-center">
        <span className="text-zinc-400">Loading Map...</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Pinpoint your location
      </div>
      <p className="text-xs text-zinc-500 mb-2">
        Click on the map to set your exact delivery location.
      </p>
      <div className="w-full h-[300px] rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-sm relative z-0">
        <MapContainer 
          center={position || DEFAULT_CENTER} 
          zoom={position ? 15 : 12} 
          className="w-full h-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler onLocationSelect={handleLocationSelect} position={position} />
        </MapContainer>
      </div>
    </div>
  );
}
