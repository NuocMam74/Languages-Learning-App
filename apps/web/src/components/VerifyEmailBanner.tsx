import { useState } from "react";
import { useAccount } from "../account.ts";
import { t } from "../i18n/index.ts";

/**
 * Bandeau « vérifie ton email » (contrat phase5 §4) avec renvoi du lien. Affiché sur l'accueil :
 * c'est une affaire de compte, pas de langue apprise (contrat phase7 §2).
 */
export function VerifyEmailBanner() {
  const account = useAccount((s) => s.account);
  const status = useAccount((s) => s.status);
  const resend = useAccount((s) => s.resendVerification);
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  if (status !== "signed_in" || !account || account.emailVerified !== false) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-ngoc-sang px-4 py-2 text-sm" data-testid="verify-banner">
      <span>{state === "sent" ? t("journey.verify.resent") : t("journey.verify.banner")}</span>
      {state !== "sent" && (
        <button
          type="button"
          disabled={state === "busy"}
          className="min-h-11 font-semibold text-ngoc"
          onClick={() => {
            setState("busy");
            void resend().then(() => setState("sent"), () => setState("error"));
          }}
        >
          {t("journey.verify.resend")}
        </button>
      )}
    </div>
  );
}
