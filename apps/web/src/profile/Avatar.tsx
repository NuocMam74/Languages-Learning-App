import { initialsOf } from "./identity.ts";

/**
 * Médaillon d'identité : les initiales du nom affiché, ou une silhouette au trait tant qu'aucun nom
 * n'est donné (spec §13 : pas d'emoji, et surtout pas un « ? » qui ressemble à une erreur).
 */
export function Avatar({ name, size = "sm" }: { name: string | null; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "size-16 text-2xl" : "size-11 text-lg";
  return (
    <span aria-hidden className={`grid ${box} shrink-0 place-items-center rounded-full bg-ngoc-sang font-serif font-semibold text-ngoc`}>
      {name ? (
        initialsOf(name)
      ) : (
        <svg viewBox="0 0 24 24" className={size === "lg" ? "size-8" : "size-6"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5.5a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4M5.5 19c.8-3.2 3.4-4.8 6.5-4.8s5.7 1.6 6.5 4.8" />
        </svg>
      )}
    </span>
  );
}
