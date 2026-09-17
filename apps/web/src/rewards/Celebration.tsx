import { collectionRewardItem, trophyByCode, wardrobeItem } from "@parlo/core";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "../components/ui.tsx";
import { Card, Icon } from "../design/index.ts";
import { playFanfareSound, playRewardSound } from "../feedback-sound.ts";
import { l, t, type MessageKey } from "../i18n/index.ts";
import { WardrobePreview } from "../profile/AvatarArt.tsx";
import { useCelebrations } from "./celebrate.ts";
import { ChestIcon, CoinIcon, TrophyIcon } from "./RewardArt.tsx";
import type { Celebration } from "./store.ts";

/**
 * La carte de félicitations (contrat phase9 §5). Une par gain, la file les fait défiler.
 *
 * Ce qu'elle respecte, et qui n'est pas négociable :
 *  - elle s'adresse à la personne **par le nom de son profil**, « toi » sans nom, jamais
 *    « utilisateur » ni un prénom inventé ;
 *  - c'est un vrai dialogue : `role="dialog"`, `aria-modal`, focus posé sur le bouton, Échap ferme,
 *    et le fond n'est pas cliquable par erreur (il faut un geste sur le voile) ;
 *  - un seul moment animé — la carte se pose (spec §13) ; `prefers-reduced-motion` retire le
 *    mouvement, pas l'information ;
 *  - le son est court et facultatif (réglages), jamais une condition pour comprendre.
 */

interface Copy {
  title: string;
  body: string;
  art: ReactNode;
  /** Fanfare pour ce qui est rare (niveau, trophée), arpège pour le reste. */
  fanfare?: boolean;
}

function copyFor(celebration: Celebration): Copy {
  switch (celebration.kind) {
    case "level":
      return {
        title: t("journey.level.up", { n: celebration.level }),
        body: celebration.name ? t("journey.level.upName", { name: l(celebration.name) }) : t("reward.level.body"),
        art: <Icon name="star" size={56} className="text-nghe" />,
        fanfare: true,
      };
    case "trophy": {
      // Les trophées se nomment par famille et par palier : une famille, trois paliers, un nom.
      const trophy = trophyByCode(celebration.code);
      return {
        title: trophy ? t("trophy.earned", { name: t(`trophy.${trophy.family}.name` as MessageKey), tier: t(`trophy.tier.${trophy.tier}` as MessageKey) }) : t("trophy.title"),
        body: trophy ? t(`trophy.${trophy.family}.desc` as MessageKey, { n: trophy.target }) : "",
        art: <TrophyIcon code={celebration.code} earned size={72} />,
        fanfare: true,
      };
    }
    case "collectible":
      return {
        title: t("reward.collectible.title", { name: t(`collection.item.${celebration.id}.name` as MessageKey) }),
        body: t("reward.collectible.body"),
        art: <ChestIcon size={72} />,
      };
    case "set": {
      // Une collection terminée offre une pièce d'atelier : c'est elle qu'on montre.
      const unlocked = collectionRewardItem(celebration.set);
      return {
        title: t("reward.set.title", { name: t(`collection.set.${celebration.set}.name` as MessageKey) }),
        body: unlocked ? t("reward.set.bodyItem", { name: t(`wardrobe.item.${unlocked.id}.name` as MessageKey) }) : t("reward.set.body"),
        art: unlocked ? <WardrobePreview slot={unlocked.slot} itemId={unlocked.id} size={72} /> : <ChestIcon size={72} />,
        fanfare: true,
      };
    }
    case "wardrobe": {
      const item = wardrobeItem(celebration.itemId);
      return {
        title: t("reward.wardrobe.title", { name: t(`wardrobe.item.${celebration.itemId}.name` as MessageKey) }),
        body: t("reward.wardrobe.body"),
        art: item ? <WardrobePreview slot={item.slot} itemId={item.id} size={72} /> : <Icon name="star" size={56} className="text-ngoc" />,
      };
    }
    case "mission":
      return {
        title: t(`mission.period.${celebration.period}.done` as MessageKey),
        body: t(`mission.${celebration.missionKind}.label` as MessageKey),
        art: <Icon name="target" size={56} className="text-ngoc" />,
      };
    case "coins":
      return {
        title: t("reward.coins.title", { n: celebration.coins }),
        body: t("reward.coins.body"),
        art: <CoinIcon size={64} />,
      };
  }
}

/** Clé de rendu : deux gains du même genre à la suite doivent bien remonter la carte. */
const keyOf = (celebration: Celebration, index: number): string => `${celebration.kind}:${index}`;

export function CelebrationLayer() {
  const queue = useCelebrations((s) => s.queue);
  const name = useCelebrations((s) => s.name);
  const dismiss = useCelebrations((s) => s.dismiss);
  const current = queue[0];
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!current) return;
    // Le focus vient sur le bouton : au clavier comme au lecteur d'écran, on sait où on est.
    button.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, dismiss]);

  useEffect(() => {
    if (!current) return;
    if (copyFor(current).fanfare) playFanfareSound();
    else playRewardSound();
  }, [current]);

  if (!current) return null;
  const copy = copyFor(current);
  const hello = name ? t("reward.hello", { name }) : t("reward.hello.anon");

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-muc/55 px-5 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
      data-testid="celebration-layer"
    >
      {/* Le voile ferme aussi : au doigt, c'est le geste attendu. Il ne porte rien d'autre. */}
      <button type="button" aria-hidden tabIndex={-1} onClick={dismiss} className="absolute inset-0 cursor-default" />
      <Card
        tone="raised"
        as="section"
        role="dialog"
        aria-modal
        aria-labelledby="celebration-title"
        data-testid="celebration"
        data-kind={current.kind}
        key={keyOf(current, queue.length)}
        className="relative flex w-full max-w-[24rem] flex-col items-center gap-3 py-6 text-center motion-safe:animate-[rise_320ms_ease-out]"
      >
        <p className="text-sm font-medium text-phu-sa">{hello}</p>
        <div className="grid min-h-[4.5rem] place-items-center">{copy.art}</div>
        <h2 id="celebration-title" className="font-serif text-2xl text-balance">{copy.title}</h2>
        <p className="text-phu-sa text-balance">{copy.body}</p>
        {queue.length > 1 && (
          <p className="text-sm text-phu-sa tabular-nums" data-testid="celebration-remaining">
            {t("reward.more", { n: queue.length - 1 })}
          </p>
        )}
        <Button ref={button} variant="reward" onClick={dismiss} className="mt-1" data-testid="celebration-ok">
          {queue.length > 1 ? t("reward.next") : t("reward.ok")}
        </Button>
      </Card>
    </div>
  );
}
