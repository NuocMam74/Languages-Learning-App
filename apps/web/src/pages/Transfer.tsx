import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Screen } from "../components/ui.tsx";
import { Card, Icon, PageHeader } from "../design/index.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import {
  applyTransfer,
  buildTransfer,
  localSummary,
  parseTransfer,
  summarize,
  type TransferError,
  type TransferFile,
  type TransferMode,
  type TransferSummary,
} from "../transfer.ts";

/**
 * Changer d'appareil (contrat phase17 §2) : un écran, deux gestes.
 *
 * Il a son propre écran plutôt qu'une ligne de plus dans les réglages, pour une raison : on n'y
 * vient qu'une fois, dans un moment précis — on a un téléphone neuf dans une main et l'ancien dans
 * l'autre — et ce qui s'y passe **écrase** ce que l'appareil contient. Ça mérite de la place, un
 * ordre clair (d'abord exporter, ensuite importer) et une comparaison avant d'écrire.
 *
 * Rien ne s'écrit sans qu'on ait vu, côte à côte, ce que contient le fichier et ce que contient
 * l'appareil. Un fichier refusé dit pourquoi il est refusé.
 */

const ERROR_MESSAGE: Record<TransferError, MessageKey> = {
  unreadable: "transfer.error.unreadable",
  not_parlo: "transfer.error.notParlo",
  too_new: "transfer.error.tooNew",
  empty: "transfer.error.empty",
};

function download(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ce que contient un appareil ou un fichier, en trois nombres et une ligne par langue. */
function SummaryCard({ title, summary, testId }: { title: string; summary: TransferSummary; testId: string }) {
  return (
    <Card tone="raised" className="flex flex-col gap-1.5" data-testid={testId}>
      <p className="text-sm text-phu-sa">{title}</p>
      <p className="text-lg font-medium">
        {t("transfer.summary.head", { xp: summary.xp, lessons: summary.lessons })}
      </p>
      {summary.packs.length === 0 ? (
        <p className="text-sm text-phu-sa">{t("transfer.summary.nothing")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-sm text-phu-sa">
          {summary.packs.map((pack) => (
            <li key={pack.code}>{t("transfer.summary.pack", { code: pack.code, lessons: pack.lessons, cards: pack.cards })}</li>
          ))}
        </ul>
      )}
      {summary.notes > 0 && <p className="text-sm text-phu-sa">{t("transfer.summary.notes", { n: summary.notes })}</p>}
    </Card>
  );
}

export default function TransferPage() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [here, setHere] = useState<TransferSummary | null>(null);
  const [incoming, setIncoming] = useState<{ file: TransferFile; summary: TransferSummary } | null>(null);
  const [error, setError] = useState<TransferError | null>(null);
  const [mode, setMode] = useState<TransferMode>("replace");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<TransferSummary | null>(null);

  useEffect(() => {
    void localSummary().then(setHere);
  }, []);

  const doExport = async () => {
    const file = await buildTransfer();
    download(`parlo-progression-${file.exportedAt.slice(0, 10)}.json`, file);
  };

  const pick = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    // Le champ est remis à zéro tout de suite : sans ça, rechoisir le même fichier n'émet rien.
    input.value = "";
    if (!chosen) return;
    setError(null);
    setIncoming(null);
    const read = parseTransfer(await chosen.text());
    if ("error" in read) {
      setError(read.error);
      return;
    }
    setIncoming({ file: read.file, summary: summarize(read.file.tables) });
  };

  const confirm = async () => {
    if (!incoming) return;
    setBusy(true);
    const summary = await applyTransfer(incoming.file, mode);
    setDone(summary);
    setBusy(false);
  };

  if (done) {
    return (
      <Screen action={<Button onClick={() => window.location.assign("/apprendre")}>{t("transfer.done.go")}</Button>}>
        <div className="flex flex-1 flex-col justify-center gap-4 text-center" data-testid="transfer-done">
          <Icon name="check" size={48} className="mx-auto text-ngoc" />
          <h1 className="font-serif text-2xl">{t("transfer.done.title")}</h1>
          <p className="text-phu-sa text-balance">
            {t("transfer.done.body", { xp: done.xp, lessons: done.lessons })}
          </p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen top={<PageHeader title={t("transfer.title")} subtitle={t("transfer.intro")} back="/reglages" backLabel={t("settings.title")} />}>
      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-xl">{t("transfer.export.title")}</h2>
        <p className="text-phu-sa text-balance">{t("transfer.export.body")}</p>
        {here && <SummaryCard title={t("transfer.here")} summary={here} testId="transfer-here" />}
        <Button variant="outline" onClick={() => void doExport()} data-testid="transfer-export">
          {t("transfer.export.action")}
        </Button>
        <p className="text-sm text-phu-sa text-balance">{t("transfer.export.note")}</p>
      </section>

      <section className="mt-8 flex flex-col gap-3">
        <h2 className="font-serif text-xl">{t("transfer.import.title")}</h2>
        <p className="text-phu-sa text-balance">{t("transfer.import.body")}</p>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          data-testid="transfer-file"
          onChange={(e) => void pick(e.currentTarget)}
        />
        <Button variant="outline" onClick={() => fileInput.current?.click()} data-testid="transfer-pick">
          {t("transfer.import.pick")}
        </Button>

        {error && (
          <Card tone="alert" className="flex items-start gap-3" data-testid="transfer-error">
            <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-son-mai" />
            <p role="alert" className="min-w-0 flex-1 text-sm text-son-mai">{t(ERROR_MESSAGE[error])}</p>
          </Card>
        )}

        {incoming && (
          <div className="flex flex-col gap-3" data-testid="transfer-confirm">
            <SummaryCard
              title={t("transfer.file", { date: incoming.file.exportedAt.slice(0, 10) })}
              summary={incoming.summary}
              testId="transfer-incoming"
            />

            {/* Le choix se pose seulement si l'appareil a quelque chose à perdre. Sur un téléphone
                neuf — le cas courant — il n'y a rien à arbitrer, et on ne pose pas la question. */}
            {here && (here.lessons > 0 || here.xp > 0) && (
              <Card tone="notice" as="section" role="radiogroup" aria-label={t("transfer.mode.title")} className="flex flex-col gap-2">
                <p className="font-medium">{t("transfer.mode.title")}</p>
                {(["replace", "merge"] as const).map((value) => (
                  <label key={value} className="flex min-h-11 items-start gap-2.5 text-sm">
                    <input
                      type="radio"
                      name="transfer-mode"
                      className="mt-1"
                      checked={mode === value}
                      onChange={() => setMode(value)}
                      data-testid={`transfer-mode-${value}`}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{t(value === "replace" ? "transfer.mode.replace" : "transfer.mode.merge")}</span>
                      <span className="block text-phu-sa">
                        {t(value === "replace" ? "transfer.mode.replace.hint" : "transfer.mode.merge.hint")}
                      </span>
                    </span>
                  </label>
                ))}
              </Card>
            )}

            <Button onClick={() => void confirm()} disabled={busy} data-testid="transfer-apply">
              {busy ? t("transfer.import.busy") : t("transfer.import.confirm")}
            </Button>
            <Button variant="quiet" onClick={() => setIncoming(null)}>{t("transfer.import.cancel")}</Button>
          </div>
        )}
      </section>

      <Card tone="quiet" className="mt-8 flex items-start gap-2.5">
        <Icon name="info" size={18} className="mt-0.5 shrink-0 text-phu-sa" />
        <p className="text-sm text-phu-sa text-balance">{t("transfer.note")}</p>
      </Card>

      <button type="button" className="mt-6 min-h-11 self-start font-semibold text-ngoc" onClick={() => navigate("/reglages")}>
        {t("transfer.back")}
      </button>
    </Screen>
  );
}
