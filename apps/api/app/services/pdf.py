"""Rendu PDF des certificats (spec §5.5, direction artistique §13).

Deux moteurs derrière `PdfRenderer` :
- `WeasyPrintRenderer` (production, image Docker) : HTML + CSS, polices embarquées ;
- `Fpdf2Renderer` (pur Python) : repli quand les bibliothèques système de WeasyPrint (Pango) manquent,
  notamment sous Windows. Même mise en page, mêmes polices.

Polices : Be Vietnam Pro et Source Serif 4 (OFL), embarquées dans `app/assets/fonts` : les diacritiques
vietnamiens empilés (ễ, ườ, ữ) sont rendus sans dépendre des polices du système.
"""

import contextlib
import functools
import html
import io
import logging
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from app.config import API_DIR

logger = logging.getLogger(__name__)

FONTS_DIR = API_DIR / "app" / "assets" / "fonts"

# Palette §13.
NUOC = "#F2F6F3"
MUC = "#14201E"
NGOC = "#0E5E55"
SON_MAI = "#C2352A"
NGHE = "#E5A21B"
PHU_SA = "#3A3A34"

SKILL_ORDER = ("listening", "reading", "vocabulary", "speaking")

LABELS: dict[str, dict[str, str]] = {
    "fr": {
        "title": "Chứng chỉ tiếng Việt miền Nam",
        "subtitle": "Certificat de vietnamien du Sud",
        "awarded": "décerné à",
        "level": "Niveau",
        "issued": "Délivré le",
        "code": "Code de vérification",
        "verify": "Vérifier ce certificat",
        "listening": "Écoute",
        "reading": "Lecture",
        "vocabulary": "Vocabulaire",
        "speaking": "Expression orale",
    },
    "en": {
        "title": "Chứng chỉ tiếng Việt miền Nam",
        "subtitle": "Certificate in Southern Vietnamese",
        "awarded": "awarded to",
        "level": "Level",
        "issued": "Issued on",
        "code": "Verification code",
        "verify": "Verify this certificate",
        "listening": "Listening",
        "reading": "Reading",
        "vocabulary": "Vocabulary",
        "speaking": "Speaking",
    },
}

# Sens du nom vietnamien du certificat (spec §5.5).
MOTTOS: dict[str, dict[str, str]] = {
    "A0": {"fr": "prendre racine", "en": "taking root"},
    "A1": {"fr": "ouvrir la parole", "en": "opening up to speak"},
    "A2": {"fr": "converser", "en": "conversing"},
}

_MONTHS_FR = [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
]


@dataclass(frozen=True)
class CertificateDocument:
    display_name: str
    level: str
    certificate_name: str
    issued_on: date
    scores: dict[str, float]
    verification_code: str
    verify_url: str
    locale: str = "fr"

    @property
    def labels(self) -> dict[str, str]:
        return LABELS.get(self.locale, LABELS["fr"])

    @property
    def motto(self) -> str:
        mottos = MOTTOS.get(self.level, {})
        return mottos.get(self.locale) or mottos.get("fr", "")

    @property
    def issued_text(self) -> str:
        d = self.issued_on
        if self.locale == "en":
            return d.strftime("%B ") + f"{d.day}, {d.year}"
        return f"{d.day} {_MONTHS_FR[d.month - 1]} {d.year}"


class PdfRenderer(Protocol):
    name: str

    def render(self, doc: CertificateDocument) -> bytes: ...


def _rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


# --- fpdf2 ----------------------------------------------------------------------------------


class Fpdf2Renderer:
    name = "fpdf2"

    def render(self, doc: CertificateDocument) -> bytes:
        from fpdf import FPDF

        labels = doc.labels
        pdf = FPDF(orientation="landscape", unit="mm", format="A4")
        pdf.set_auto_page_break(False)
        pdf.set_margins(0, 0, 0)
        pdf.c_margin = 0
        pdf.set_title(f"{doc.certificate_name} — {doc.display_name}")
        pdf.set_author("Parlo")
        pdf.set_creator("Parlo")
        pdf.add_font("Sans", "", str(FONTS_DIR / "BeVietnamPro-Regular.ttf"))
        pdf.add_font("Sans", "B", str(FONTS_DIR / "BeVietnamPro-SemiBold.ttf"))
        pdf.add_font("SansLight", "", str(FONTS_DIR / "BeVietnamPro-Light.ttf"))
        pdf.add_font("Serif", "", str(FONTS_DIR / "SourceSerif4-Regular.ttf"))
        pdf.add_font("Serif", "B", str(FONTS_DIR / "SourceSerif4-Semibold.ttf"))
        pdf.add_font("Serif", "I", str(FONTS_DIR / "SourceSerif4-It.ttf"))
        pdf.add_page()
        width, height = pdf.w, pdf.h

        # Fond eau claire, double filet jade, bandeau laque à gauche.
        pdf.set_fill_color(*_rgb(NUOC))
        pdf.rect(0, 0, width, height, style="F")
        pdf.set_fill_color(*_rgb(NGOC))
        pdf.rect(0, 0, 14, height, style="F")
        pdf.set_fill_color(*_rgb(SON_MAI))
        pdf.rect(14, 0, 2.5, height, style="F")
        pdf.set_draw_color(*_rgb(NGOC))
        pdf.set_line_width(0.8)
        pdf.rect(26, 12, width - 38, height - 24)
        pdf.set_line_width(0.25)
        pdf.rect(29, 15, width - 44, height - 30)

        left = 44
        content_width = width - left - 40

        def text(
            y: float,
            value: str,
            family: str,
            style: str,
            size: float,
            color: str,
            align: str = "L",
            x: float = left,
            w: float = content_width,
        ) -> None:
            pdf.set_font(family, style, size)
            pdf.set_text_color(*_rgb(color))
            pdf.set_xy(x, y)
            pdf.cell(w, size * 0.5, value, align=align)

        text(26, "Parlo", "Serif", "B", 15, NGOC)
        text(40, labels["title"], "Serif", "B", 30, MUC)
        text(55, labels["subtitle"], "SansLight", "", 13, PHU_SA)
        text(74, labels["awarded"], "Serif", "I", 13, PHU_SA)
        text(84, doc.display_name, "Serif", "B", 34, NGOC)

        # Filet curcuma sous le nom.
        pdf.set_draw_color(*_rgb(NGHE))
        pdf.set_line_width(0.9)
        pdf.line(left, 104, left + 70, 104)

        text(112, f"{labels['level']} {doc.level}", "Sans", "B", 11, PHU_SA)
        text(120, doc.certificate_name, "Serif", "B", 22, SON_MAI)
        if doc.motto:
            text(132, doc.motto, "Serif", "I", 12, PHU_SA)

        # Scores par compétence : libellé, barre, pourcentage.
        col_w = (content_width - 90) / 4
        y = 148
        for i, skill in enumerate(SKILL_ORDER):
            x = left + i * col_w
            value = max(0.0, min(1.0, doc.scores.get(skill, 0.0)))
            text(y, labels[skill], "Sans", "", 10, PHU_SA, x=x, w=col_w - 6)
            text(y + 7, f"{round(value * 100)} %", "Sans", "B", 16, MUC, x=x, w=col_w - 6)
            pdf.set_fill_color(*_rgb("#D9E3DE"))
            pdf.rect(x, y + 18, col_w - 10, 1.6, style="F")
            pdf.set_fill_color(*_rgb(NGOC))
            pdf.rect(x, y + 18, (col_w - 10) * value, 1.6, style="F")

        text(171, f"{labels['issued']} {doc.issued_text}", "Sans", "", 10, PHU_SA)
        text(178, f"{labels['code']} : {doc.verification_code}", "Sans", "B", 10, MUC)
        pdf.set_font("Sans", "", 9)
        pdf.set_text_color(*_rgb(NGOC))
        pdf.set_xy(left, 184.5)
        pdf.cell(content_width - 90, 4.5, f"{labels['verify']} : {doc.verify_url}", link=doc.verify_url)

        # Sceau : disque curcuma, anneau laque, niveau au centre.
        cx, cy, r = width - 70, 160, 24
        pdf.set_fill_color(*_rgb(NGHE))
        pdf.circle(x=cx, y=cy, radius=r, style="F")
        pdf.set_draw_color(*_rgb(SON_MAI))
        pdf.set_line_width(1.2)
        pdf.circle(x=cx, y=cy, radius=r - 3, style="D")
        pdf.set_line_width(0.3)
        pdf.circle(x=cx, y=cy, radius=r - 5, style="D")
        text(cy - 8, doc.level, "Serif", "B", 30, SON_MAI, align="C", x=cx - r, w=2 * r)
        text(cy + 7, "Parlo", "Serif", "I", 10, MUC, align="C", x=cx - r, w=2 * r)

        return bytes(pdf.output())


# --- WeasyPrint -----------------------------------------------------------------------------


class WeasyPrintRenderer:
    name = "weasyprint"

    def render(self, doc: CertificateDocument) -> bytes:
        from weasyprint import HTML

        return bytes(HTML(string=certificate_html(doc), base_url=str(FONTS_DIR)).write_pdf())


def certificate_html(doc: CertificateDocument) -> str:
    e = html.escape
    labels = doc.labels
    font = FONTS_DIR.as_uri()
    skills = "".join(
        f'<div class="skill"><span>{e(labels[s])}</span><strong>{round(doc.scores.get(s, 0.0) * 100)} %</strong>'
        f'<i><b style="width:{max(0.0, min(1.0, doc.scores.get(s, 0.0))) * 100:.1f}%"></b></i></div>'
        for s in SKILL_ORDER
    )
    motto = f'<p class="motto">{e(doc.motto)}</p>' if doc.motto else ""
    return f"""<!doctype html><html lang="{e(doc.locale)}"><head><meta charset="utf-8"><style>
@font-face {{ font-family: Sans; src: url("{font}/BeVietnamPro-Regular.ttf"); }}
@font-face {{ font-family: Sans; font-weight: 600; src: url("{font}/BeVietnamPro-SemiBold.ttf"); }}
@font-face {{ font-family: Serif; src: url("{font}/SourceSerif4-Regular.ttf"); }}
@font-face {{ font-family: Serif; font-weight: 600; src: url("{font}/SourceSerif4-Semibold.ttf"); }}
@font-face {{ font-family: Serif; font-style: italic; src: url("{font}/SourceSerif4-It.ttf"); }}
@page {{ size: A4 landscape; margin: 0; }}
body {{ margin: 0; font-family: Sans, sans-serif; color: {MUC}; background: {NUOC}; line-height: 1.5; }}
.page {{ position: relative; width: 297mm; height: 210mm; box-sizing: border-box;
  border-left: 14mm solid {NGOC}; box-shadow: inset 2.5mm 0 0 {SON_MAI}; }}
.frame {{ position: absolute; inset: 12mm 12mm 12mm 12mm; border: 0.8mm solid {NGOC}; }}
.frame::after {{ content: ""; position: absolute; inset: 2.5mm; border: 0.25mm solid {NGOC}; }}
.body {{ position: absolute; left: 30mm; top: 20mm; right: 26mm; }}
.brand {{ font-family: Serif; font-weight: 600; color: {NGOC}; font-size: 15pt; margin: 0; }}
h1 {{ font-family: Serif; font-weight: 600; font-size: 30pt; line-height: 1.25; margin: 4mm 0 0; }}
.subtitle {{ color: {PHU_SA}; margin: 0; font-size: 13pt; }}
.awarded {{ font-family: Serif; font-style: italic; color: {PHU_SA}; margin: 8mm 0 0; }}
.name {{ font-family: Serif; font-weight: 600; font-size: 34pt; color: {NGOC}; line-height: 1.3; margin: 0;
  border-bottom: 0.9mm solid {NGHE}; display: inline-block; padding-bottom: 1mm; }}
.level {{ font-weight: 600; color: {PHU_SA}; margin: 5mm 0 0; font-size: 11pt; }}
.cert {{ font-family: Serif; font-weight: 600; font-size: 22pt; color: {SON_MAI}; margin: 0; line-height: 1.3; }}
.motto {{ font-family: Serif; font-style: italic; color: {PHU_SA}; margin: 0; }}
.skills {{ display: flex; gap: 8mm; margin-top: 6mm; width: 190mm; }}
.skill {{ flex: 1; font-size: 10pt; color: {PHU_SA}; }}
.skill strong {{ display: block; font-size: 16pt; color: {MUC}; }}
.skill i {{ display: block; height: 1.6mm; background: #D9E3DE; }}
.skill b {{ display: block; height: 100%; background: {NGOC}; }}
.meta {{ margin-top: 7mm; font-size: 10pt; color: {PHU_SA}; }}
.meta strong {{ color: {MUC}; }}
.meta a {{ color: {NGOC}; text-decoration: none; }}
.seal {{ position: absolute; right: 46mm; top: 136mm; width: 48mm; height: 48mm; border-radius: 50%;
  background: {NGHE}; box-shadow: inset 0 0 0 3mm {NGHE}, inset 0 0 0 4.2mm {SON_MAI}; text-align: center; }}
.seal span {{ display: block; font-family: Serif; font-weight: 600; font-size: 30pt; color: {SON_MAI};
  margin-top: 8mm; }}
.seal em {{ font-family: Serif; color: {MUC}; }}
</style></head><body><div class="page"><div class="frame"></div><div class="body">
<p class="brand">Parlo</p><h1>{e(labels["title"])}</h1><p class="subtitle">{e(labels["subtitle"])}</p>
<p class="awarded">{e(labels["awarded"])}</p><p class="name">{e(doc.display_name)}</p>
<p class="level">{e(labels["level"])} {e(doc.level)}</p><p class="cert">{e(doc.certificate_name)}</p>{motto}
<div class="skills">{skills}</div>
<div class="meta">{e(labels["issued"])} {e(doc.issued_text)}<br>
<strong>{e(labels["code"])} : {e(doc.verification_code)}</strong><br>
<a href="{e(doc.verify_url)}">{e(labels["verify"])} : {e(doc.verify_url)}</a></div>
</div><div class="seal"><span>{e(doc.level)}</span><em>Parlo</em></div></div></body></html>"""


@functools.cache
def weasyprint_available() -> bool:
    # WeasyPrint écrit un long message d'installation quand Pango manque : sonde silencieuse.
    sink = io.StringIO()
    try:
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            import weasyprint  # noqa: F401
    except (ImportError, OSError):
        return False
    return True


def make_renderer(choice: str = "auto") -> PdfRenderer:
    if choice == "fpdf2":
        return Fpdf2Renderer()
    if choice == "weasyprint" or (choice == "auto" and weasyprint_available()):
        return WeasyPrintRenderer()
    if choice == "auto":
        logger.info("WeasyPrint indisponible (bibliothèques système absentes) : rendu PDF avec fpdf2")
    return Fpdf2Renderer()
