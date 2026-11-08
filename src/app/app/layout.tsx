import { AppDataProvider } from "@/components/app/app-data";
import { BottomNav } from "@/components/app/bottom-nav";
import { ReviewPrompt } from "@/components/app/review-prompt";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppDataProvider>
      <div className="mx-auto min-h-dvh max-w-md pb-32">{children}</div>
      <BottomNav />
      <ReviewPrompt />
    </AppDataProvider>
  );
}
