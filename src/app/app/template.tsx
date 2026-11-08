/** Rejoué à chaque changement d'écran de l'appli client : légère apparition. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
