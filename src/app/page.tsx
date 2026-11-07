import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { homeFor } from "@/lib/roles";

export default async function Root() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/connexion");
  const { data } = await sb.from("profiles").select("role").eq("id", user.id).single();
  redirect(homeFor(data?.role));
}
