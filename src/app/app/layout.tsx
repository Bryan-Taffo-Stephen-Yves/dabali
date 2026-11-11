import { AppDataProvider } from "@/components/app/app-data";
import { BottomNav } from "@/components/app/bottom-nav";
import { ReviewPrompt } from "@/components/app/review-prompt";
import { OfflineBanner } from "@/components/app/offline-banner";
import { AppLock } from "@/components/app/app-lock";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppDataProvider>
      <div className="mx-auto min-h-dvh max-w-md pb-32"><OfflineBanner />{children}</div>
      <BottomNav />
      <ReviewPrompt />
      <AppLock />
    </AppDataProvider>
  );
}
