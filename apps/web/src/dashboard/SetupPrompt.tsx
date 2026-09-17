import { DEFAULT_OUTFIT, WARDROBE_SLOTS } from "@parlo/core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card, Icon } from "../design/index.ts";
import { getKv, setKv } from "../db.ts";
import { t } from "../i18n/index.ts";
import { readDisplayName } from "../profile/identity.ts";
import { loadRewardsData, wornOutfit } from "../rewards/store.ts";

/**
 * Invitation à finir de configurer son espace : son **nom** et son **personnage**.
 *
 * Ton (spec §5.8) : une invitation, jamais un reproche. Elle ne dit pas ce qui manque comme un
 * formulaire incomplet — elle dit ce qu'on y gagne (« les félicitations t'appelleront par ton
 * nom »). Elle se referme pour de bon d'un geste, et ne revient pas.
 *
 * Elle n'apparaît qu'une fois la première séance faite : avant, la seule chose à faire est
 * d'apprendre quelque chose, pas de remplir son profil.
 */

const DISMISSED_KEY = "setupPrompt.dismissed";

/** Le personnage est-il resté celui du premier jour ? */
function isDefaultOutfit(outfit: Record<string, string | undefined>): boolean {
  return WARDROBE_SLOTS.every((slot) => outfit[slot] === DEFAULT_OUTFIT[slot]);
}

interface Todo {
  name: boolean;
  character: boolean;
}

export default function SetupPrompt({ started }: { started: boolean }) {
  const [todo, setTodo] = useState<Todo | null>(null);

  useEffect(() => {
    if (!started) return;
    let live = true;
    void (async () => {
      const [dismissed, name, rewards] = await Promise.all([getKv<boolean>(DISMISSED_KEY, false), readDisplayName(), loadRewardsData()]);
      if (!live || dismissed) return;
      setTodo({ name: !name, character: isDefaultOutfit(wornOutfit(rewards)) });
    })();
    return () => {
      live = false;
    };
  }, [started]);

  if (!todo || (!todo.name && !todo.character)) return null;

  const dismiss = () => {
    setTodo(null);
    void setKv(DISMISSED_KEY, true);
  };

  return (
    <Card tone="notice" as="section" data-testid="setup-prompt" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-serif text-lg">{t("setup.title")}</h3>
          <p className="text-sm text-phu-sa text-balance">{t("setup.body")}</p>
        </div>
        <Icon name="star" size={20} className="shrink-0 text-nghe" />
      </div>
      <div className="flex flex-col">
        {todo.name && (
          <Link to="/profil" data-testid="setup-name" className="flex min-h-11 items-center gap-2 border-t border-nghe/20 pt-2 font-semibold text-ngoc first:border-t-0 first:pt-0">
            <Icon name="user" size={18} />
            <span className="min-w-0 flex-1">{t("setup.name")}</span>
            <Icon name="chevronRight" size={18} className="text-phu-sa" />
          </Link>
        )}
        {todo.character && (
          <Link to="/atelier" data-testid="setup-character" className="flex min-h-11 items-center gap-2 border-t border-nghe/20 pt-2 font-semibold text-ngoc first:border-t-0 first:pt-0">
            <Icon name="trophy" size={18} />
            <span className="min-w-0 flex-1">{t("setup.character")}</span>
            <Icon name="chevronRight" size={18} className="text-phu-sa" />
          </Link>
        )}
      </div>
      <button type="button" onClick={dismiss} data-testid="setup-dismiss" className="min-h-11 self-start text-sm text-phu-sa underline-offset-4 hover:underline">
        {t("setup.later")}
      </button>
    </Card>
  );
}
