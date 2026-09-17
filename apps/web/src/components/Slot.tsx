import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Emplacement réservé pour un contenu chargé après le premier rendu (carte réseau, ligne de ligue…).
 * Anti-CLS : tant que le contenu n'est pas arrivé, l'emplacement garde la hauteur qu'il avait à la
 * dernière visite (ou `fallback`), puis se libère dès que le contenu a une hauteur, ou après `settleMs`.
 * La hauteur mémorisée est par appareil (localStorage), jamais bloquante.
 */

const PREFIX = "parlo.slot.";

function readHeight(id: string): number | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 && n < 2000 ? n : null;
  } catch {
    return null;
  }
}

function writeHeight(id: string, height: number) {
  try {
    localStorage.setItem(PREFIX + id, String(Math.round(height)));
  } catch {
    // Stockage indisponible (navigation privée) : on réserve simplement moins bien.
  }
}

export function Slot({ id, children, fallback = 0, settleMs = 2500, className = "" }: {
  /** Clé stable de l'emplacement (hauteur mémorisée). */
  id: string;
  children: ReactNode;
  /** Hauteur réservée à la toute première visite (px). */
  fallback?: number;
  /** Au-delà, un contenu toujours vide libère la place. */
  settleMs?: number;
  className?: string;
}) {
  const [reserve, setReserve] = useState(() => readHeight(id) ?? fallback);
  const inner = useRef<HTMLDivElement>(null);
  const released = useRef(false);
  const reserveRef = useRef(reserve);
  reserveRef.current = reserve;

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") {
      setReserve(0);
      return;
    }
    const observer = new ResizeObserver(() => {
      const height = el.getBoundingClientRect().height;
      if (height === 0) {
        // Contenu retiré (carte fermée) : la prochaine visite ne réserve plus rien.
        if (released.current) writeHeight(id, 0);
        return;
      }
      // Un squelette plus court que la place réservée ne libère pas encore (le contenu final arrive).
      if (height < reserveRef.current) return;
      writeHeight(id, height);
      released.current = true;
      setReserve(0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id]);

  useEffect(() => {
    if (reserve === 0) return;
    const timer = window.setTimeout(() => {
      const height = inner.current?.getBoundingClientRect().height ?? 0;
      writeHeight(id, height);
      released.current = true;
      setReserve(0);
    }, settleMs);
    return () => window.clearTimeout(timer);
  }, [id, reserve, settleMs]);

  return (
    <div className={className} style={reserve > 0 ? { minHeight: reserve } : undefined} data-slot={id}>
      {/* flow-root : les marges des enfants comptent dans la hauteur mesurée. */}
      <div ref={inner} className="flow-root">
        {children}
      </div>
    </div>
  );
}
