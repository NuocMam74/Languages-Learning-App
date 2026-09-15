"""E-mails transactionnels (contrat parcours §4) : `EMAIL_BACKEND=console|smtp`.

- `console` : message journalisé et conservé en mémoire (`outbox`), pour le développement et les tests ;
- `smtp` : envoi via `SMTP_HOST`/`SMTP_PORT` (STARTTLS ou SSL, authentification facultative).
"""

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage as MimeMessage
from typing import Protocol

from app.config import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    text: str


class EmailSender(Protocol):
    def send(self, message: EmailMessage) -> None: ...


class ConsoleEmailSender:
    """Journalise le message et le garde en mémoire (les 200 derniers)."""

    def __init__(self) -> None:
        self.outbox: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> None:
        self.outbox.append(message)
        del self.outbox[:-200]
        logger.info("E-mail (console) à %s : %s\n%s", message.to, message.subject, message.text)


class SmtpEmailSender:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def send(self, message: EmailMessage) -> None:
        s = self._settings
        mime = MimeMessage()
        mime["From"] = s.email_from
        mime["To"] = message.to
        mime["Subject"] = message.subject
        mime.set_content(message.text)
        context = ssl.create_default_context()
        if s.smtp_ssl:
            with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=context, timeout=15) as smtp:
                self._deliver(smtp, mime)
        else:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
                if s.smtp_starttls:
                    smtp.starttls(context=context)
                self._deliver(smtp, mime)

    def _deliver(self, smtp: smtplib.SMTP, mime: MimeMessage) -> None:
        if self._settings.smtp_username:
            smtp.login(self._settings.smtp_username, self._settings.smtp_password or "")
        smtp.send_message(mime)


def make_email_sender(settings: Settings) -> EmailSender:
    backend = settings.email_backend.strip().lower()
    if backend == "smtp":
        return SmtpEmailSender(settings)
    if backend != "console":
        raise ValueError(f"EMAIL_BACKEND inconnu : {settings.email_backend} (console | smtp)")
    return ConsoleEmailSender()


def send_safely(sender: EmailSender, message: EmailMessage) -> bool:
    """Un échec d'envoi ne doit ni révéler l'existence d'un compte ni casser la requête."""
    try:
        sender.send(message)
    except Exception:
        logger.exception("Envoi de l'e-mail « %s » impossible", message.subject)
        return False
    return True


# --- Gabarits ---------------------------------------------------------------------------------


def password_reset_message(to: str, locale: str, link: str, minutes: int) -> EmailMessage:
    if locale == "en":
        return EmailMessage(
            to,
            "Parlo: reset your password",
            f"Hello,\n\nTo choose a new password, open this link (valid {minutes} minutes, single use):\n{link}\n\n"
            "If you did not ask for this, you can ignore this e-mail.\n",
        )
    return EmailMessage(
        to,
        "Parlo : réinitialise ton mot de passe",
        f"Bonjour,\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable {minutes} minutes, une seule "
        f"fois) :\n{link}\n\nSi tu n'as rien demandé, ignore simplement ce message.\n",
    )


def verify_email_message(to: str, locale: str, link: str) -> EmailMessage:
    if locale == "en":
        return EmailMessage(
            to, "Parlo: confirm your e-mail address", f"Hello,\n\nConfirm your e-mail address:\n{link}\n"
        )
    return EmailMessage(
        to, "Parlo : confirme ton adresse e-mail", f"Bonjour,\n\nConfirme ton adresse e-mail :\n{link}\n"
    )
