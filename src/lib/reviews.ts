import { supabase } from "@/lib/supabase/client";

export const COMPLAINTS: { code: string; label: string; emoji: string }[] = [
  { code: "froid", label: "Froid", emoji: "🥶" },
  { code: "pas_cuit", label: "Pas assez cuit", emoji: "🍳" },
  { code: "trop_sale", label: "Trop salé", emoji: "🧂" },
  { code: "fade", label: "Fade", emoji: "😐" },
  { code: "portion", label: "Portion trop petite", emoji: "🤏" },
  { code: "attente", label: "Attente trop longue", emoji: "⏳" },
  { code: "corps_etranger", label: "Corps étranger", emoji: "⚠️" },
  { code: "autre", label: "Autre", emoji: "💬" },
];
export const complaintLabel = (c: string) => COMPLAINTS.find((x) => x.code === c)?.label ?? c;

export type PendingReview = { ticket_id: string; dish: string; photo_url: string | null; service: string; used_at: string };

export const reviewPhotoUrl = (path: string | null | undefined) =>
  path ? supabase().storage.from("reviews").getPublicUrl(path).data.publicUrl : null;

/** Réduit la photo dans le téléphone avant l'envoi (1080 px, JPEG ~75 %) : rapide même en 3G. */
export async function compressPhoto(file: File, max = 1080): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("compression"))), "image/jpeg", 0.75));
}
