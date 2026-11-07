import type { Metadata } from "next";
import { AppDataProvider } from "@/components/app/app-data";
import { BottomNav } from "@/components/app/bottom-nav";

export const metadata: Metadata = { manifest: "/manifest.webmanifest" };

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppDataProvider>
      <div className="mx-auto min-h-dvh max-w-md pb-32">{children}</div>
      <BottomNav />
    </AppDataProvider>
  );
}
