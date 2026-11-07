import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { homeFor } from "@/lib/roles";

// Accès par espace (la vraie sécurité reste la RLS ; ceci évite d'afficher un écran inutilisable).
const AREA_ROLES: Record<string, string[]> = {
  "/app": ["client", "agent", "caissier", "chef", "admin"],
  "/scan": ["agent", "admin"],
  "/admin": ["caissier", "chef", "admin"],
  "/courses": ["agent", "caissier", "chef", "admin"],
};


export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await sb.auth.getUser();
  const path = req.nextUrl.pathname;
  const area = Object.keys(AREA_ROLES).find((a) => path === a || path.startsWith(a + "/"));
  const isAuthPage = path === "/connexion" || path === "/inscription";

  const redirect = (to: string) => {
    const r = NextResponse.redirect(new URL(to, req.url));
    res.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (!user) {
    if (area || path === "/") return redirect("/connexion");
    return res;
  }

  if (area || path === "/" || isAuthPage) {
    const { data: profile } = await sb.from("profiles").select("role").eq("id", user.id).single();
    const role = profile?.role as string | undefined;
    if (path === "/" || isAuthPage) return redirect(homeFor(role));
    if (area && !AREA_ROLES[area].includes(role ?? "")) return redirect(homeFor(role));
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/|favicon|icons/|manifest|sw\\.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)"],
};
