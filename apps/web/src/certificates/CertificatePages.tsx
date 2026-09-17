import { EXAM_SKILLS, type ContentIndex } from "@parlo/core";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { BackHeader } from "../exams/BackHeader.tsx";
import { useAccount } from "../account.ts";
import { ApiError, getCertificatePdf, getCertificates, verifyCertificate, type CertificateDto, type VerifyResult } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
import { Card, Diploma, EmptyState, Icon, Illustration, Skeleton } from "../design/index.ts";
import { loadExam, splitCertificateName } from "../exams/exam-files.ts";
import { getLocale, l, t, type MessageKey } from "../i18n/index.ts";
import { useOnline } from "../use-online.ts";
import { downloadBlob, renderCertificateImage, shareImage } from "./share-image.ts";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric" });

async function certificateName(pack: string, level: string): Promise<string> {
  const exam = await loadExam(pack, level);
  return exam ? splitCertificateName(l(exam.certificate), exam.level).name : level;
}

export interface CertificateInfo {
  id: string;
  level: string;
  issuedAt: string;
  verificationCode: string;
}

/** Télécharger le PDF (API authentifiée → blob) et partager l'image carrée. */
export function CertificateActions({ content, certificate }: { content: ContentIndex; certificate: CertificateInfo }) {
  const account = useAccount((s) => s.account);
  const [busy, setBusy] = useState<"pdf" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pdf = async () => {
    setBusy("pdf");
    setError(null);
    try {
      downloadBlob(await getCertificatePdf(certificate.id), `parlo-certificat-${certificate.level}-${certificate.verificationCode}.pdf`);
    } catch {
      setError(t("exams.error.generic"));
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setBusy("share");
    setError(null);
    try {
      const name = await certificateName(content.pack.code, certificate.level);
      const verifyUrl = `${window.location.origin}/verifier/${certificate.verificationCode}`;
      const blob = await renderCertificateImage({
        displayName: account?.displayName ?? "",
        level: certificate.level,
        name,
        issuedAt: certificate.issuedAt,
        code: certificate.verificationCode,
        verifyUrl,
        locale: getLocale(),
        labels: { awarded: t("cert.image.awarded"), tagline: t("cert.image.tagline"), verify: t("cert.image.verify") },
      });
      await shareImage(blob, `parlo-${certificate.level}.png`, `${certificate.level} ${name} · ${verifyUrl}`);
    } catch {
      setError(t("exams.error.generic"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Deux gestes, deux boutons pleine largeur : emporter le diplôme doit être évident. */}
      <Button
        variant="outline"
        disabled={busy !== null}
        onClick={() => void pdf()}
        className="flex items-center justify-center gap-2 disabled:border-line-strong disabled:text-phu-sa/60"
      >
        <Icon name="download" size={20} />
        {busy === "pdf" ? t("cert.pdf.loading") : t("cert.pdf")}
      </Button>
      <Button
        variant="outline"
        disabled={busy !== null}
        onClick={() => void share()}
        className="flex items-center justify-center gap-2 disabled:border-line-strong disabled:text-phu-sa/60"
      >
        <Icon name="share" size={20} />
        {busy === "share" ? t("cert.share.loading") : t("cert.share")}
      </Button>
      {error && <p role="alert" className="text-sm text-son-mai">{error}</p>}
    </div>
  );
}

/** Écran de félicitations juste après la réussite. */
export function CertificateReady({ content, certificate, onDone }: { content: ContentIndex; certificate: CertificateInfo; onDone: () => void }) {
  const [name, setName] = useState(certificate.level);
  useEffect(() => {
    void certificateName(content.pack.code, certificate.level).then((n) => setName(`${certificate.level} ${n}`));
  }, [content, certificate.level]);
  return (
    <Screen action={<Button onClick={onDone}>{t("exams.result.home")}</Button>}>
      <div className="flex flex-1 flex-col gap-5 pt-4" data-testid="certificate-ready">
        {/* Seul moment héroïque de l'écran : le diplôme se pose, le reste ne bouge pas. */}
        <Illustration className="mx-auto max-w-[15rem] motion-safe:parlo-enter">
          <Diploma />
        </Illustration>
        <div className="flex flex-col gap-1 text-center">
          <p lang="vi" className="font-serif text-vi leading-tight text-ngoc">{t("cert.congrats")}</p>
          <p className="text-lg text-balance">{t("cert.congratsBody", { name })}</p>
        </div>
        <CertificateCard content={content} certificate={certificate} />
        <Link to="/certificats" className="flex min-h-11 items-center justify-center gap-2 font-semibold text-ngoc">
          {t("exams.certificates")}
          <Icon name="chevronRight" size={18} />
        </Link>
      </div>
    </Screen>
  );
}

function Seal({ level }: { level: string }) {
  return (
    <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-son-mai font-serif text-xl font-semibold text-nuoc outline-2 -outline-offset-6 outline-nuoc">
      {level}
    </span>
  );
}

function CertificateCard({ content, certificate }: { content: ContentIndex; certificate: CertificateInfo }) {
  const [name, setName] = useState("");
  useEffect(() => {
    void certificateName(content.pack.code, certificate.level).then(setName);
  }, [content, certificate.level]);
  return (
    // Un objet qu'on garde : surface décollée du fond, sceau, air autour — pas une ligne de liste.
    <Card as="article" tone="raised" className="flex flex-col gap-5" data-testid="certificate">
      <div className="flex items-center gap-4">
        <Seal level={certificate.level} />
        <div className="min-w-0 flex-1">
          <p lang="vi" className="font-serif text-2xl italic text-ngoc">{name}</p>
          <p className="text-sm text-phu-sa">{t("cert.issued", { date: formatDate(certificate.issuedAt) })}</p>
          <p className="text-sm text-phu-sa">{t("cert.code", { code: certificate.verificationCode })}</p>
        </div>
      </div>
      <CertificateActions content={content} certificate={certificate} />
    </Card>
  );
}

export function CertificatesPage({ content }: { content: ContentIndex }) {
  const online = useOnline();
  const status = useAccount((s) => s.status);
  const [list, setList] = useState<CertificateDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (status !== "signed_in" || !online) return;
    getCertificates().then(setList, () => setFailed(true));
  }, [status, online]);

  let body: ReactNode;
  if (status !== "signed_in") {
    body = (
      <Card tone="notice" className="flex items-start gap-3">
        <Icon name="user" className="mt-0.5 shrink-0 text-muc" />
        <p className="min-w-0 flex-1">{t("exams.real.account")}</p>
      </Card>
    );
  } else if (!online || failed) {
    body = (
      <Card tone="alert" className="flex items-start gap-3">
        <Icon name={online ? "alert" : "offline"} className="mt-0.5 shrink-0 text-son-mai" />
        <p className="min-w-0 flex-1">{t(online ? "exams.error.generic" : "cert.offline")}</p>
      </Card>
    );
  } else if (!list) {
    // Lecture de l'API : le gabarit d'un certificat, pas un écran qui attend en blanc.
    body = (
      <div className="flex flex-col gap-5">
        <Skeleton rounded="card" className="h-52" />
        <Skeleton rounded="card" className="h-52" />
      </div>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        art="diploma"
        title={t("cert.empty")}
        action={
          <Link to="/examens" className="inline-flex min-h-11 items-center gap-2 rounded-chip px-3 font-semibold text-ngoc">
            <Icon name="diploma" size={18} />
            {t("exams.title")}
          </Link>
        }
      />
    );
  } else {
    body = <div className="flex flex-col gap-5">{list.map((c) => <CertificateCard key={c.id} content={content} certificate={c} />)}</div>;
  }

  return (
    <Screen top={<BackHeader title={t("cert.title")} to="/examens" />}>
      {body}
    </Screen>
  );
}

/** Page publique de vérification : /verifier/:code. */
export function VerifyPage() {
  const { code = "" } = useParams();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "valid"; result: VerifyResult } | { kind: "invalid" } | { kind: "error" }>({ kind: "loading" });

  useEffect(() => {
    verifyCertificate(code).then(
      (result) => setState(result.valid ? { kind: "valid", result } : { kind: "invalid" }),
      (error: unknown) => setState(error instanceof ApiError && error.status === 404 ? { kind: "invalid" } : { kind: "error" }),
    );
  }, [code]);

  return (
    <Screen>
      <div className="flex flex-1 flex-col gap-6 pt-6" data-testid="verify" data-state={state.kind}>
        <div>
          <p className="font-serif text-xl text-ngoc">Parlo</p>
          <h1 className="font-serif text-2xl">{t("cert.verify.title")}</h1>
          <p className="text-sm text-phu-sa tabular-nums">{code}</p>
        </div>
        {state.kind === "loading" && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton rounded="card" className="h-56" />
            <p className="text-phu-sa" role="status">{t("cert.verify.loading")}</p>
          </div>
        )}
        {state.kind === "invalid" && (
          <Card tone="alert" className="flex items-start gap-3">
            <Icon name="alert" className="mt-0.5 shrink-0 text-son-mai" />
            <p className="min-w-0 flex-1 text-lg">{t("cert.verify.invalid")}</p>
          </Card>
        )}
        {state.kind === "error" && <p className="text-phu-sa">{t("cert.verify.error")}</p>}
        {state.kind === "valid" && (
          <Card as="article" tone="raised" className="flex flex-col gap-5">
            <p className="flex items-center gap-3 text-lg font-semibold text-ngoc">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ngoc-sang">
                <Icon name="check" size={20} />
              </span>
              {t("cert.verify.valid")}
            </p>
            <div className="flex items-center gap-4">
              <Seal level={state.result.level} />
              <p lang="vi" className="font-serif text-2xl italic text-ngoc">{l(state.result.certificate)}</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-phu-sa">{t("cert.verify.holder")}</dt>
              <dd className="font-serif text-lg">{state.result.displayName}</dd>
              <dt className="text-phu-sa">{t("cert.verify.level")}</dt>
              <dd>{state.result.level}</dd>
              <dt className="text-phu-sa">{t("cert.verify.date")}</dt>
              <dd>{formatDate(state.result.issuedAt)}</dd>
            </dl>
            <div>
              <h2 className="mb-2 text-phu-sa">{t("cert.verify.scores")}</h2>
              <ul className="flex flex-col gap-1">
                {EXAM_SKILLS.map((skill) => (
                  <li key={skill} className="flex justify-between border-b border-line pb-1">
                    <span>{t(`exams.skill.${skill}` as MessageKey)}</span>
                    <span className="font-semibold tabular-nums">{Math.round((state.result.scores[skill] ?? 0) * 100)} %</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}
        <p className="text-sm text-phu-sa">{t("cert.verify.about")}</p>
      </div>
    </Screen>
  );
}
