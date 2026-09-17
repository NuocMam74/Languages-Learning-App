import type { Localized } from "@parlo/core";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import { loadPackInfo } from "../content.ts";
import { l, t } from "../i18n/index.ts";
import { activePackCode, isAvailablePack, packOfLesson } from "../packs/active.ts";
import { switchPack } from "../packs/switch.ts";

/**
 * Lien profond vers une leçon d'une **autre** langue (contrat phase7 §1) : on demande d'abord
 * confirmation, puis on bascule la langue active (`pack_switched`) et on ouvre la leçon.
 *
 * Sans cette garde, la leçon serait cherchée dans le contenu de la langue courante et l'écran
 * afficherait « leçon inconnue » — alors que l'apprenant a bien cliqué sur un lien valide.
 */
export function DeepLinkGuard({ children }: { children: ReactNode }) {
  const { lessonId = "" } = useParams();
  const target = packOfLesson(lessonId);
  const foreign = target !== activePackCode() && isAvailablePack(target);
  if (!foreign) return children;
  return <SwitchPrompt code={target} lessonId={lessonId} />;
}

function SwitchPrompt({ code, lessonId }: { code: string; lessonId: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState<Localized | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void loadPackInfo(code).then((pack) => live && setName(pack?.name ?? null));
    return () => {
      live = false;
    };
  }, [code]);

  const confirm = () => {
    setBusy(true);
    void switchPack(code)
      // Contenu et progression de l'autre langue : redémarrage propre, puis la leçon demandée.
      .then(() => window.location.assign(`/lecon/${encodeURIComponent(lessonId)}`))
      .catch(() => setBusy(false));
  };

  const label = name ? l(name) : code;
  return (
    <Screen
      action={
        <div className="flex flex-col gap-2">
          <Button disabled={busy} onClick={confirm} data-testid="deeplink-confirm">
            {busy ? t("packs.switching") : t("dashboard.deepLink.confirm", { name: label })}
          </Button>
          <Button variant="quiet" onClick={() => navigate("/apprendre", { replace: true })}>{t("dashboard.deepLink.cancel")}</Button>
        </div>
      }
    >
      <div className="flex flex-1 flex-col justify-center gap-3" data-testid="deeplink-prompt" data-pack={code}>
        <h1 className="font-serif text-2xl">{t("dashboard.deepLink.title", { name: label })}</h1>
        <p className="text-lg text-phu-sa">{t("dashboard.deepLink.body")}</p>
      </div>
    </Screen>
  );
}
