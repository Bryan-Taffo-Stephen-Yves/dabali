export type Role = "client" | "agent" | "caissier" | "chef" | "admin";

export function homeFor(role: string | undefined | null) {
  if (role === "agent") return "/scan";
  if (role === "caissier" || role === "chef" || role === "admin") return "/admin";
  return "/app";
}
