"""Pipeline audio du studio (docs/AUDIO.md) — portage Python de `scripts/audio/process.ts` et `ffmpeg.ts`.

Enregistrement (wav | webm) → décodage PCM 48 kHz mono → rognage des bords + loudnorm deux passes
(−16 LUFS, TP −1,5, LRA 11) → `<base>.opus` (libopus 48 kbps) + `<base>.m4a` (AAC 64 kbps)
→ version lente `<base>_slow.{opus,m4a}` par time-stretch sans changement de hauteur (rubberband, sinon atempo).

La courbe F0 de référence est calculée côté client (`@parlo/core/pitch`) ; le serveur la valide strictement
(`parse_pitch_reference`, portage de `parsePitchReference`) et l'écrit comme `serializePitchReference`.
"""

import json
import math
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

SLOW_TEMPO = 0.75
OPUS_BITRATE = "48k"
AAC_BITRATE = "64k"
LOUDNESS = {"I": -16, "TP": -1.5, "LRA": 11}
# Rognage des bords : ~150 ms de silence conservés avant/après la parole.
TRIM = (
    "aformat=channel_layouts=mono,"
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15:detection=peak,"
    "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15:detection=peak,areverse"
)
FFMPEG_TIMEOUT_SECONDS = 120
TONES = ("ngang", "huyen", "sac", "hoi", "nga", "nang")


class AudioError(Exception):
    """Échec du pipeline (ffmpeg absent, fichier illisible…)."""


class PitchReferenceError(ValueError):
    pass


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _run(binary: str, args: list[str]) -> subprocess.CompletedProcess[bytes]:
    exe = shutil.which(binary)
    if exe is None:
        raise AudioError(f"{binary} introuvable dans le PATH")
    try:
        proc = subprocess.run(  # noqa: S603  (arguments construits par le serveur, sans shell)
            [exe, *args], capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS, check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise AudioError(f"{binary} : délai dépassé") from exc
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.decode("utf-8", errors="replace").splitlines()[-15:])
        raise AudioError(f"{binary} a échoué (code {proc.returncode})\n{tail}")
    return proc


def ffmpeg(args: list[str]) -> str:
    return _run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "info", *args]).stderr.decode(
        "utf-8", errors="replace"
    )


@lru_cache
def has_filter(name: str) -> bool:
    out = _run("ffmpeg", ["-hide_banner", "-filters"]).stdout.decode("utf-8", errors="replace")
    return re.search(rf"^\s*[A-Z.|]+\s+{re.escape(name)}\s", out, re.MULTILINE) is not None


def stretch_filter() -> tuple[str, str]:
    """(filtre, méthode) : rubberband si le build ffmpeg l'a, sinon atempo. Jamais asetrate."""
    if has_filter("rubberband"):
        return f"rubberband=tempo={SLOW_TEMPO}:pitch=1:pitchq=quality", "rubberband"
    return f"atempo={SLOW_TEMPO}", "atempo"


@dataclass(frozen=True)
class ProbeInfo:
    duration: float
    sample_rate: int
    channels: int
    codec: str


def probe(file: Path) -> ProbeInfo:
    out = _run(
        "ffprobe",
        [
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels:format=duration",
            "-of",
            "json",
            str(file),
        ],
    ).stdout
    data = json.loads(out.decode("utf-8"))
    streams = data.get("streams") or [{}]
    stream = streams[0]
    try:
        duration = float((data.get("format") or {}).get("duration", "nan"))
    except ValueError:
        duration = math.nan
    return ProbeInfo(
        duration=duration,
        sample_rate=int(stream.get("sample_rate") or 0),
        channels=int(stream.get("channels") or 0),
        codec=str(stream.get("codec_name") or "?"),
    )


def measure_loudness(input_file: Path, prefilter: str) -> dict[str, str]:
    """Passe 1 de loudnorm : mesure sur le flux déjà filtré par `prefilter`."""
    loud = f"loudnorm=I={LOUDNESS['I']}:TP={LOUDNESS['TP']}:LRA={LOUDNESS['LRA']}:print_format=json"
    af = f"{prefilter},{loud}" if prefilter else loud
    stderr = ffmpeg(["-i", str(input_file), "-af", af, "-f", "null", "-"])
    start, end = stderr.rfind("{"), stderr.rfind("}")
    if start < 0 or end < start:
        raise AudioError("loudnorm : mesure illisible")
    measure: dict[str, str] = json.loads(stderr[start : end + 1])
    return measure


def loudnorm_filter(m: dict[str, str]) -> str:
    """Filtre loudnorm de passe 2 (linéaire) à partir de la mesure."""
    return ":".join(
        [
            f"loudnorm=I={LOUDNESS['I']}:TP={LOUDNESS['TP']}:LRA={LOUDNESS['LRA']}",
            f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}",
            f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true:print_format=summary",
        ]
    )


def encode(input_file: Path, output: Path, codec: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    codec_args = (
        ["-c:a", "libopus", "-b:a", OPUS_BITRATE, "-vbr", "on", "-application", "audio", "-ar", "48000"]
        if codec == "opus"
        else ["-c:a", "aac", "-b:a", AAC_BITRATE, "-ar", "48000", "-movflags", "+faststart"]
    )
    ffmpeg(["-y", "-i", str(input_file), "-ac", "1", "-map_metadata", "-1", *codec_args, str(output)])


@dataclass(frozen=True)
class ProcessedAudio:
    # Chemins écrits (relatifs à `out_dir`) et durées en ms.
    files: list[tuple[str, int]]
    input_rate: int
    lufs_in: float | None
    stretch: str


def detect_format(head: bytes) -> str | None:
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    return None


def process_recording(source: Path, out_dir: Path, base: str) -> ProcessedAudio:
    """Écrit `audio/<base>.opus|m4a` et `audio/<base>_slow.opus|m4a` sous `out_dir`."""
    stretch, method = stretch_filter()
    outputs = {
        "opus": out_dir / "audio" / f"{base}.opus",
        "m4a": out_dir / "audio" / f"{base}.m4a",
        "slow_opus": out_dir / "audio" / f"{base}_slow.opus",
        "slow_m4a": out_dir / "audio" / f"{base}_slow.m4a",
    }
    with tempfile.TemporaryDirectory(prefix="parlo-audio-") as tmp_name:
        tmp = Path(tmp_name)
        info = probe(source)
        # Décodage (webm/opus du navigateur ou wav) en PCM flottant 48 kHz mono.
        decoded = tmp / "decoded.wav"
        ffmpeg(["-y", "-i", str(source), "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", str(decoded)])
        measure = measure_loudness(decoded, TRIM)
        norm = tmp / "norm.wav"
        ffmpeg(
            [
                "-y",
                "-i",
                str(decoded),
                "-af",
                f"{TRIM},{loudnorm_filter(measure)},aresample=48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_f32le",
                str(norm),
            ]
        )
        encode(norm, outputs["opus"], "opus")
        encode(norm, outputs["m4a"], "aac")
        slow = tmp / "slow.wav"
        ffmpeg(["-y", "-i", str(norm), "-af", stretch, "-ac", "1", "-c:a", "pcm_f32le", str(slow)])
        encode(slow, outputs["slow_opus"], "opus")
        encode(slow, outputs["slow_m4a"], "aac")
    try:
        lufs_in: float | None = float(measure.get("input_i", "nan"))
    except ValueError:
        lufs_in = None
    files = [(path.relative_to(out_dir).as_posix(), round(probe(path).duration * 1000)) for path in outputs.values()]
    return ProcessedAudio(files=files, input_rate=info.sample_rate, lufs_in=lufs_in, stretch=method)


# --- Courbe de référence ---------------------------------------------------------------------


def _is_number(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)


def parse_pitch_reference(value: Any) -> dict[str, Any]:
    """Portage strict de `parsePitchReference` (packages/core/src/pitch/contour.ts)."""

    def fail(msg: str) -> PitchReferenceError:
        return PitchReferenceError(f"référence de hauteur invalide : {msg}")

    data = value
    if isinstance(data, str | bytes):
        try:
            data = json.loads(data)
        except ValueError as exc:
            raise fail("JSON illisible") from exc
    if not isinstance(data, dict):
        raise fail("objet attendu")
    for key in data:
        if key not in ("v", "hopMs", "st", "syllables"):
            raise fail(f"clé inconnue « {key} »")
    if data.get("v") != 1 or isinstance(data.get("v"), bool):
        raise fail("v doit valoir 1")
    hop = data.get("hopMs")
    if not _is_number(hop) or hop <= 0 or hop > 100:
        raise fail("hopMs hors bornes")
    st_raw = data.get("st")
    if not isinstance(st_raw, list) or not st_raw or len(st_raw) > 100_000:
        raise fail("st doit être un tableau non vide")
    st: list[float | None] = []
    for i, v in enumerate(st_raw):
        if v is None:
            st.append(None)
        elif not _is_number(v) or abs(v) > 48:
            raise fail(f"st[{i}] invalide")
        else:
            st.append(v)
    if all(v is None for v in st):
        raise fail("aucune trame voisée")
    ref: dict[str, Any] = {"v": 1, "hopMs": hop, "st": st}
    if "syllables" in data:
        syllables = data["syllables"]
        if not isinstance(syllables, list):
            raise fail("syllables doit être un tableau")
        total = len(st) * hop
        prev_end = 0.0
        out = []
        for i, s in enumerate(syllables):
            if not isinstance(s, dict):
                raise fail(f"syllables[{i}] : objet attendu")
            for key in s:
                if key not in ("start", "end", "tone"):
                    raise fail(f"syllables[{i}] : clé inconnue « {key} »")
            start, end, tone = s.get("start"), s.get("end"), s.get("tone")
            if not _is_number(start) or not _is_number(end):
                raise fail(f"syllables[{i}] : bornes numériques attendues")
            if start < prev_end or end <= start or end > total + 1e-6:
                raise fail(f"syllables[{i}] : bornes incohérentes")
            if tone not in TONES:
                raise fail(f"syllables[{i}] : ton inconnu")
            prev_end = end
            out.append({"start": start, "end": end, "tone": tone})
        ref["syllables"] = out
    return ref


def _js_number(x: float | int) -> float | int:
    """Nombre tel que JSON.stringify l'écrirait (1.0 → 1, -0 → 0)."""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x


def _round1(x: float) -> float | int:
    # Math.round(x * 10) / 10 || 0 (arrondi « demi vers +∞ » comme en JS).
    return _js_number(math.floor(x * 10 + 0.5) / 10) or 0


def serialize_pitch_reference(ref: dict[str, Any]) -> str:
    clean: dict[str, Any] = {
        "v": 1,
        "hopMs": _js_number(ref["hopMs"]),
        "st": [None if v is None else _round1(v) for v in ref["st"]],
    }
    if "syllables" in ref:
        clean["syllables"] = [
            {"start": _js_number(s["start"]), "end": _js_number(s["end"]), "tone": s["tone"]} for s in ref["syllables"]
        ]
    parse_pitch_reference(clean)
    return json.dumps(clean, separators=(",", ":"), ensure_ascii=False)
