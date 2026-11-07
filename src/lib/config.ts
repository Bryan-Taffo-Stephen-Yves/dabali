// Valeurs PUBLIQUES (URL du projet + clé anon). Aucun secret ici : la sécurité repose sur la RLS.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://punghxwtknejxkedaoty.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1bmdoeHd0a25lanhrZWRhb3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5ODI5MDEsImV4cCI6MjEwOTU1ODkwMX0.6a92Pd0x-vmGKsZnfEa-nLRuKQRa92ERbqY6uukdMsY";

export const APP_NAME = "Dabali";
