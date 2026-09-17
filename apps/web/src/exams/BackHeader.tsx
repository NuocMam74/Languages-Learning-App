import { PageHeader } from "../design/index.ts";
import { t } from "../i18n/index.ts";

/**
 * En-tête d'écran secondaire. Il ne dessine plus rien lui-même : le retour est au même endroit sur
 * tous les écrans (contrat phase8 §1), donc il délègue à `PageHeader` du système de design. Les
 * appelants historiques (`title`, `to`) n'ont pas bougé.
 */
export function BackHeader({ title, to = "/" }: { title: string; to?: string }) {
  return <PageHeader title={title} back={to} backLabel={t("common.back")} />;
}
