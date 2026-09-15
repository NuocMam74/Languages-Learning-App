"""Rendu PDF des certificats (fpdf2 ; WeasyPrint si ses bibliothèques système sont présentes) et migrations."""

import io
import unicodedata
from datetime import date
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from pypdf import PdfReader

from app.config import API_DIR
from app.services.pdf import CertificateDocument, Fpdf2Renderer, WeasyPrintRenderer, make_renderer, weasyprint_available
from app.services.storage import LocalStorage

DOC = CertificateDocument(
    display_name="Trần Thị Ngọc Ánh",
    level="A1",
    certificate_name="A1 Mở lời",
    issued_on=date(2026, 9, 14),
    scores={"listening": 0.875, "reading": 0.8333, "vocabulary": 1.0, "speaking": 0.6667},
    verification_code="7K3M9QXZ2A",
    verify_url="https://parlo.test/verifier/7K3M9QXZ2A",
    locale="en",
)


def extract(data: bytes) -> str:
    return unicodedata.normalize("NFC", PdfReader(io.BytesIO(data)).pages[0].extract_text())


def test_fpdf2_certificate_text_with_vietnamese_diacritics() -> None:
    data = Fpdf2Renderer().render(DOC)
    assert data.startswith(b"%PDF")
    text = extract(data)
    for expected in ("Trần Thị Ngọc Ánh", "A1 Mở lời", "Chứng chỉ tiếng Việt miền Nam", "7K3M9QXZ2A", DOC.verify_url):
        assert expected in text
    assert "September 14, 2026" in text
    assert "88 %" in text and "67 %" in text


def test_renderer_selection() -> None:
    assert make_renderer("fpdf2").name == "fpdf2"
    assert make_renderer("auto").name == ("weasyprint" if weasyprint_available() else "fpdf2")


@pytest.mark.skipif(not weasyprint_available(), reason="WeasyPrint : bibliothèques Pango absentes (Windows)")
def test_weasyprint_certificate() -> None:
    text = extract(WeasyPrintRenderer().render(DOC))
    assert "Trần Thị Ngọc Ánh" in text
    assert "7K3M9QXZ2A" in text


def test_local_storage_rejects_path_escape(tmp_path: Path) -> None:
    storage = LocalStorage(tmp_path)
    storage.save("certificates/a.pdf", b"%PDF", "application/pdf")
    assert storage.load("certificates/a.pdf") == b"%PDF"
    assert storage.load("certificates/missing.pdf") is None
    with pytest.raises(ValueError):
        storage.save("../escape.pdf", b"x", "application/pdf")


def test_migrations_upgrade_downgrade_and_match_models(tmp_path: Path) -> None:
    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{(tmp_path / 'mig.db').as_posix()}")
    command.upgrade(config, "head")
    command.downgrade(config, "0002")
    command.upgrade(config, "head")
    command.check(config)  # lève si les modèles divergent du schéma migré
