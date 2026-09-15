import { EXAM_SKILLS, type ContentIndex } from "@parlo/core";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { BackHeader } from "../exams/BackHeader.tsx";
import { useAccount } from "../account.ts";
import { ApiError, getCertificatePdf, getCertificates, verifyCertificate, type CertificateDto, type VerifyResult } from "../api.ts";
import { Button, Screen } from "../components/ui.tsx";
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
      <div className="flex flex-wrap gap-x-6">
        <button type="button" disabled={busy !== null} onClick={() => void pdf()} className="min-h-11 font-semibold text-ngoc disabled:text-phu-sa/60">
          {busy === "pdf" ? t("cert.pdf.loading") : t("cert.pdf")}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void share()} className="min-h-11 font-semibold text-ngoc disabled:text-phu-sa/60">
          {busy === "share" ? t("cert.share.loading") : t("cert.share")}
        </button>
      </div>
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
      <div className="flex flex-1 flex-col gap-6 pt-10" data-testid="certificate-ready">
        <p lang="vi" className="font-serif text-vi text-ngoc motion-safe:animate-[rise_600ms_ease-out]">{t("cert.congrats")}</p>
        <p className="text-lg">{t("cert.congratsBody", { name })}</p>
        <CertificateCard content={content} certificate={certificate} />
        <Link to="/certificats" className="min-h-11 self-start py-2 font-semibold text-ngoc">{t("exams.certificates")}</Link>
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
    <article className="flex flex-col gap-4 border-y-2 border-double border-ngoc py-5" data-testid="certificate">
      <div className="flex items-center gap-4">
        <Seal level={certificate.level} />
        <div>
          <p lang="vi" className="font-serif text-2xl italic text-ngoc">{name}</p>
          <p className="text-sm text-phu-sa">{t("cert.issued", { date: formatDate(certificate.issuedAt) })}</p>
          <p className="text-sm text-phu-sa">{t("cert.code", { code: certificate.verificationCode })}</p>
        </div>
      </div>
      <CertificateActions content={content} certificate={certificate} />
    </article>
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
  if (status !== "signed_in") body = <p className="text-phu-sa">{t("exams.real.account")}</p>;
  else if (!online || failed) body = <p className="text-phu-sa">{t(online ? "exams.error.generic" : "cert.offline")}</p>;
  else if (!list) body = null;
  else if (list.length === 0) body = <p className="text-phu-sa">{t("cert.empty")}</p>;
  else body = <div className="flex flex-col gap-6">{list.map((c) => <CertificateCard key={c.id} content={content} certificate={c} />)}</div>;

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
        {state.kind === "loading" && <p className="text-phu-sa">{t("cert.verify.loading")}</p>}
        {state.kind === "invalid" && <p className="border-l-4 border-son-mai pl-3 text-lg">{t("cert.verify.invalid")}</p>}
        {state.kind === "error" && <p className="text-phu-sa">{t("cert.verify.error")}</p>}
        {state.kind === "valid" && (
          <article className="flex flex-col gap-5 border-y-2 border-double border-ngoc py-6">
            <p className="flex items-center gap-3 text-lg font-semibold text-ngoc">
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
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
                  <li key={skill} className="flex justify-between border-b border-phu-sa/10 pb-1">
                    <span>{t(`exams.skill.${skill}` as MessageKey)}</span>
                    <span className="font-semibold tabular-nums">{Math.round((state.result.scores[skill] ?? 0) * 100)} %</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        )}
        <p className="text-sm text-phu-sa">{t("cert.verify.about")}</p>
      </div>
    </Screen>
  );
}
