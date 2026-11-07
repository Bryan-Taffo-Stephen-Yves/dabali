"use client";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

export function PageHeader({ title, back = true, right }: { title: string; back?: boolean; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 bg-canvas/90 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] backdrop-blur">
      {back && (
        <button onClick={() => (history.length > 1 ? router.back() : router.push("/app"))} aria-label="Retour"
          className="grid size-11 place-items-center rounded-full bg-card shadow-[var(--shadow-card)] active:scale-95">
          <ChevronLeft className="size-5" />
        </button>
      )}
      <h1 className="flex-1 truncate text-xl font-extrabold tracking-tight">{title}</h1>
      {right}
    </header>
  );
}
