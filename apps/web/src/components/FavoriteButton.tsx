import { useEffect, useState } from "react";
import { Icon } from "../design/index.ts";
import { favoriteId } from "../db.ts";
import { useFavorites, type FavoriteTarget } from "../favorites.ts";
import { t } from "../i18n/index.ts";

/**
 * Le cœur (contrat phase18 §2). Un seul geste, au même endroit partout : dans l'en-tête d'un
 * exercice, sur le bilan d'une leçon, sur une ligne de la bibliothèque.
 *
 * Il ne demande pas confirmation et ne félicite pas : aimer et retirer sont le même bouton, et le
 * regret coûte un toucher. Son libellé dit l'action, pas l'état — « Retirer des favoris » quand
 * c'est déjà aimé — parce que c'est ce qu'un lecteur d'écran doit annoncer avant qu'on appuie.
 */
export function FavoriteButton({ target, size = 22, className = "", label }: {
  target: FavoriteTarget;
  size?: number;
  className?: string;
  /** Précision lue par les aides techniques (« cette leçon », « cet exercice »). */
  label?: string;
}) {
  const ids = useFavorites((s) => s.ids);
  const loaded = useFavorites((s) => s.loaded);
  const load = useFavorites((s) => s.load);
  const toggle = useFavorites((s) => s.toggle);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const id = favoriteId(target.lessonId, target.stepIndex);
  const liked = ids.has(id);
  // La pulsation ne se joue qu'au moment où l'on aime, jamais au chargement d'une liste déjà
  // remplie de cœurs pleins : un accusé de réception, pas une décoration.
  const [popping, setPopping] = useState(false);
  const name = label ?? t(target.stepIndex === undefined ? "favorites.target.lesson" : "favorites.target.step");

  return (
    <button
      type="button"
      onClick={() => {
        void toggle(target).then((now) => setPopping(now));
      }}
      aria-pressed={liked}
      aria-label={`${t(liked ? "favorites.remove" : "favorites.add")} — ${name}`}
      title={t(liked ? "favorites.remove" : "favorites.add")}
      data-testid="favorite-button"
      data-liked={liked}
      data-favorite={id}
      className={`grid size-11 shrink-0 place-items-center rounded-full transition-[background-color,transform] motion-safe:active:scale-[.92] ${
        liked ? "text-son-mai hover:bg-son-mai/10" : "text-phu-sa hover:bg-phu-sa/8"
      } ${className}`}
    >
      <Icon
        name={liked ? "heartFull" : "heart"}
        size={size}
        className={popping ? "motion-safe:parlo-pop" : ""}
        onAnimationEnd={() => setPopping(false)}
      />
    </button>
  );
}
