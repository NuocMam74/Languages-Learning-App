import { useEffect, useState } from "react";

/**
 * Hauteur visible réduite (téléphone couché, clavier ouvert) : la zone visuelle (`visualViewport`)
 * rétrécit avec le clavier même quand la mise en page ne bouge pas (iOS), contrairement aux media queries.
 */
export function visibleHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

export function useCompactViewport(maxHeight = 500): boolean {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && visibleHeight() < maxHeight);
  useEffect(() => {
    const update = () => setCompact(visibleHeight() < maxHeight);
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
  }, [maxHeight]);
  return compact;
}
