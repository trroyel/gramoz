"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";

// Leaflet CSS needs to be imported for the map to render correctly
import "leaflet/dist/leaflet.css";

// Fix for default Leaflet icon paths in Next.js/Webpack
const createIcon = (url: string) => {
  return new L.Icon({
    iconUrl: url,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });
};

const truckIconUrl = "https://cdn-icons-png.flaticon.com/512/2769/2769339.png"; // Free truck icon
const storeIconUrl = "https://cdn-icons-png.flaticon.com/512/1043/1043324.png"; // Store icon
const homeIconUrl = "https://cdn-icons-png.flaticon.com/512/25/25694.png"; // Home icon

const truckIcon = createIcon(truckIconUrl);
const storeIcon = createIcon(storeIconUrl);
const homeIcon = createIcon(homeIconUrl);

interface TrackingMapProps {
  origin: [number, number];
  destination: [number, number];
  currentLocation: [number, number];
  status: string;
}

export default function TrackingMap({ origin, destination, currentLocation, status }: TrackingMapProps) {
  // To avoid hydration mismatch, only render the map on the client
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-full h-64 bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-xl flex items-center justify-center">
        <span className="text-zinc-400">Loading Map...</span>
      </div>
    );
  }

  // Calculate bounds to fit all markers
  const bounds = L.latLngBounds([origin, destination, currentLocation]);

  return (
    <div className="w-full h-[400px] rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-sm relative z-0">
      <MapContainer 
        bounds={bounds} 
        scrollWheelZoom={false}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* Route Line */}
        <Polyline 
          positions={[origin, destination]} 
          color="#3b82f6" 
          weight={4} 
          dashArray="10, 10" 
          opacity={0.6}
        />
        
        {/* Traveled Route Line (Origin to Current) */}
        <Polyline 
          positions={[origin, currentLocation]} 
          color="#22c55e" 
          weight={4}
        />

        <Marker position={origin} icon={storeIcon}>
          <Popup>
            <div className="font-semibold">Warehouse</div>
            <div className="text-xs text-zinc-500">Puthia, Rajshahi</div>
          </Popup>
        </Marker>

        <Marker position={destination} icon={homeIcon}>
          <Popup>
            <div className="font-semibold">Destination</div>
            <div className="text-xs text-zinc-500">Delivery Address</div>
          </Popup>
        </Marker>

        <Marker position={currentLocation} icon={truckIcon}>
          <Popup>
            <div className="font-semibold text-green-600">Current Location</div>
            <div className="text-xs">{status}</div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}
