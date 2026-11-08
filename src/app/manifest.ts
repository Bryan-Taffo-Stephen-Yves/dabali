import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Dabali — Cantine connectée",
    short_name: "Dabali",
    description: "Rechargez, réservez votre plat, présentez votre QR.",
    lang: "fr",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F7F9",
    theme_color: "#F6F7F9",
    categories: ["food", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Mon QR", url: "/app/tickets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Menu", url: "/app/menu", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
