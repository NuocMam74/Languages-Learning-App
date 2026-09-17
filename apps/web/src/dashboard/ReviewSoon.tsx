import { Link } from "react-router";
import { Screen } from "../components/ui.tsx";
import { t } from "../i18n/index.ts";

/**
 * Écran d'attente de « Réviser » (contrat phase8 §2 : bibliothèque de tout ce qui a été vu).
 *
 * L'onglet du bas en a besoin dès maintenant (contrat phase8 §4) et aucun écran ne doit renvoyer
 * vers une fonctionnalité absente (§5) : en attendant la bibliothèque, on annonce ce qui arrive et
 * on propose les révisions dues, qui existent déjà.
 *
 * À remplacer par la vraie page `/reviser` : supprimer ce fichier et changer l'élément de la route.
 */
export default function ReviewSoon() {
  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center gap-3" data-testid="review-soon">
        <h1 className="font-serif text-2xl">{t("review.soon.title")}</h1>
        <p className="text-lg text-phu-sa">{t("review.soon.body")}</p>
        <Link to="/revision" className="min-h-11 self-start py-2 font-semibold text-ngoc" data-testid="review-soon-due">
          {t("review.soon.due")}
        </Link>
        <Link to="/apprendre" className="min-h-11 self-start py-2 font-semibold text-ngoc">
          {t("review.soon.path")}
        </Link>
      </div>
    </Screen>
  );
}
