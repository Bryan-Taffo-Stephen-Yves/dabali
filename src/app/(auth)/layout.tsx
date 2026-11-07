import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Logo />
        <span className="rounded-full bg-lime-soft px-3 py-1 text-xs font-bold text-lime-deep">Cantine connectée</span>
      </header>
      {children}
    </main>
  );
}
