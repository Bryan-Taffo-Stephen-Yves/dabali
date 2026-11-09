"use client";
import { useId } from "react";
import clsx from "clsx";
import { bitmojiById, bitmojiSvg, defaultBitmoji, type Mood } from "@/lib/bitmoji";

/** Bitmoji d'une personne : son choix (Profil), sinon un personnage fixe tiré de son identifiant */
export function Bitmoji({ avatar, seed, mood = "happy", className, bounce }: {
  avatar?: string | null; seed?: string | null; mood?: Mood; className?: string; bounce?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const def = bitmojiById(avatar) ?? defaultBitmoji(seed ?? "dabali");
  return (
    <span className={clsx("inline-block shrink-0 overflow-hidden rounded-full [&>svg]:size-full", bounce && "animate-pop", className)}
      dangerouslySetInnerHTML={{ __html: bitmojiSvg(def, mood, uid) }} />
  );
}
