import type { Metadata, Viewport } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { RegisterSW } from "@/components/register-sw";

export const metadata: Metadata = {
  title: { default: "Dabali", template: "%s · Dabali" },
  description: "Votre cantine dans la poche : rechargez, réservez, scannez.",
  applicationName: "Dabali",
  appleWebApp: { capable: true, title: "Dabali", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#F6F7F9",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-dvh">
        <ToastProvider>{children}</ToastProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
