import { useEffect, type ReactNode } from "react";
import { useRewards, wornOutfit } from "../rewards/store.ts";
import { AvatarArt, hasAvatarArt } from "./AvatarArt.tsx";

/**
 * Le personnage, là où il y a la place (contrat phase9 §4). Chargé à la demande par l'appelant ;
 * tant qu'il n'est pas là, le médaillon d'initiales tient exactement la même place — rien ne se
 * décale quand il arrive (CLS).
 */
export default function ProfileAvatar({ size = 44, fallback = null }: { size?: number; fallback?: ReactNode }) {
  const data = useRewards((s) => s.data);
  const loaded = useRewards((s) => s.loaded);

  useEffect(() => {
    if (!loaded) void useRewards.getState().load();
  }, [loaded]);

  const outfit = wornOutfit(data);
  if (!loaded || !hasAvatarArt(outfit)) return fallback;
  return <AvatarArt outfit={outfit} size={size} />;
}
