"""Audio du studio (contrat Phase 4 §1) : pipeline ffmpeg, courbe F0, mise à jour du concept, aperçu."""

import json
import re
import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Base
from app.main import create_app
from app.services import studio
from app.services.audio import parse_pitch_reference, serialize_pitch_reference
from tests.test_studio import PACK, FakeValidator, editor

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe absents du PATH")

PITCH = {"v": 1, "hopMs": 10, "st": [0.3, 0.25, None, -0.54], "syllables": [{"start": 0, "end": 30, "tone": "sac"}]}


@pytest.fixture
def audio_settings(studio_settings: Settings) -> Settings:
    return studio_settings.model_copy(update={"studio_audio_max_bytes": 2 * 1024 * 1024})


@pytest.fixture
def aclient(audio_settings: Settings) -> Iterator[TestClient]:
    app = create_app(audio_settings)
    Base.metadata.create_all(app.state.engine)
    app.state.content_validator = FakeValidator()
    with TestClient(app, base_url="https://testserver") as c:
        yield c
    app.state.engine.dispose()
    studio.clear_content_caches()


def sine_wav(path: Path, seconds: float = 1.0) -> Path:
    """Sinus 220 Hz entouré de 0,5 s de silence, 48 kHz mono 24 bits."""
    subprocess.run(  # noqa: S603
        [
            shutil.which("ffmpeg") or "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=220:sample_rate=48000:duration={seconds},volume=0.3,adelay=500,apad=pad_dur=0.5",
            "-ac",
            "1",
            "-c:a",
            "pcm_s24le",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path


def ffprobe(path: Path) -> dict[str, Any]:
    out = subprocess.run(  # noqa: S603
        [
            shutil.which("ffprobe") or "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,sample_rate,channels:format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
    ).stdout
    data: dict[str, Any] = json.loads(out)
    return data


def integrated_lufs(path: Path) -> float:
    proc = subprocess.run(  # noqa: S603
        [
            shutil.which("ffmpeg") or "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-af",
            "ebur128",
            "-f",
            "null",
            "-",
        ],
        check=True,
        capture_output=True,
    )
    matches = re.findall(r"I:\s+(-?[\d.]+) LUFS", proc.stderr.decode("utf-8", errors="replace"))
    return float(matches[-1])


@needs_ffmpeg
def test_upload_processes_audio_and_updates_concept(
    aclient: TestClient, audio_settings: Settings, tmp_path: Path
) -> None:
    headers = editor(aclient)
    wav = sine_wav(tmp_path / "take.wav")
    with wav.open("rb") as fh:
        res = aclient.post(
            f"/studio/packs/{PACK}/audio",
            headers=headers,
            files={"file": ("take.wav", fh, "audio/wav")},
            data={"conceptId": "c_es_adios", "voice": "mateo", "pitch": json.dumps(PITCH)},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    paths = [f["path"] for f in body["files"]]
    assert paths == [
        "audio/c_es_adios_mateo.opus",
        "audio/c_es_adios_mateo.m4a",
        "audio/c_es_adios_mateo_slow.opus",
        "audio/c_es_adios_mateo_slow.m4a",
    ]
    assert body["pitch"] == {"path": "pitch/c_es_adios.json"}

    media = audio_settings.studio_media_dir / PACK
    durations = {f["path"]: f["durationMs"] for f in body["files"]}
    natural = durations["audio/c_es_adios_mateo.opus"]
    slow = durations["audio/c_es_adios_mateo_slow.opus"]
    # 1 s de son + ~150 ms de silence conservé de chaque côté (rognage des 500 ms).
    assert 1150 <= natural <= 1450, natural
    assert 1.25 <= slow / natural <= 1.42, (natural, slow)

    opus = ffprobe(media / "audio" / "c_es_adios_mateo.opus")
    assert opus["streams"][0] == {"codec_name": "opus", "sample_rate": "48000", "channels": 1}
    m4a = ffprobe(media / "audio" / "c_es_adios_mateo_slow.m4a")
    assert m4a["streams"][0]["codec_name"] == "aac" and m4a["streams"][0]["sample_rate"] == "48000"
    assert abs(integrated_lufs(media / "audio" / "c_es_adios_mateo.opus") - (-16)) <= 1.5

    pitch_text = (media / "pitch" / "c_es_adios.json").read_text("utf-8")
    assert pitch_text == '{"v":1,"hopMs":10,"st":[0.3,0.3,null,-0.5],"syllables":[{"start":0,"end":30,"tone":"sac"}]}\n'

    doc = aclient.get(f"/studio/packs/{PACK}/documents/concept/c_es_adios", headers=headers).json()
    data = doc["draft"]["data"]
    assert data["pitch"] == "pitch/c_es_adios.json"
    mateo = [a for a in data["audio"] if a["voice"] == "mateo_co_m"]
    assert mateo == [
        {"voice": "mateo_co_m", "src": "audio/c_es_adios_mateo.opus", "source": "native", "speed": "natural"},
        {"voice": "mateo_co_m", "src": "audio/c_es_adios_mateo_slow.opus", "source": "native", "speed": "slow"},
    ]
    assert any(a["voice"] == "lucia_mx_f" for a in data["audio"])  # autres voix conservées

    preview = aclient.get(f"/studio/packs/{PACK}/audio/audio/c_es_adios_mateo.opus", headers=headers)
    assert preview.status_code == 200 and preview.headers["content-type"] == "audio/ogg"
    assert preview.content == (media / "audio" / "c_es_adios_mateo.opus").read_bytes()
    assert aclient.get(f"/studio/packs/{PACK}/audio/pitch/c_es_adios.json", headers=headers).status_code == 200
    for bad in ("audio/../../pack.json", "audio/..%2F..%2Fpack.json", "pack.json", "audio/%2e%2e/%2e%2e/pack.json"):
        assert aclient.get(f"/studio/packs/{PACK}/audio/{bad}", headers=headers).status_code == 404, bad
    assert aclient.get(f"/studio/packs/{PACK}/audio/audio/c_es_adios_mateo.opus").status_code == 401

    # Publication : le concept et ses médias du studio sont copiés dans CONTENT_DIR.
    body = {"documents": [{"kind": "concept", "id": "c_es_adios"}], "message": "Voix de Mateo"}
    published = aclient.post(f"/studio/packs/{PACK}/publish", headers=headers, json=body)
    assert published.status_code == 200, published.text
    assert set(published.json()["written"]) == {
        "es/concepts/c_es_adios.json",
        "es/audio/c_es_adios_mateo.opus",
        "es/audio/c_es_adios_mateo.m4a",
        "es/audio/c_es_adios_mateo_slow.opus",
        "es/audio/c_es_adios_mateo_slow.m4a",
        "es/pitch/c_es_adios.json",
        "es/pack.json",
    }
    content = audio_settings.content_dir / PACK
    assert (content / "audio" / "c_es_adios_mateo.m4a").read_bytes() == (
        media / "audio" / "c_es_adios_mateo.m4a"
    ).read_bytes()
    assert (content / "pitch" / "c_es_adios.json").read_text("utf-8") == pitch_text


@needs_ffmpeg
def test_upload_rejections(aclient: TestClient, tmp_path: Path) -> None:
    headers = editor(aclient)
    url = f"/studio/packs/{PACK}/audio"
    wav = sine_wav(tmp_path / "take.wav", seconds=0.5).read_bytes()

    def post(data: dict[str, str], content: bytes = wav) -> Any:
        return aclient.post(url, headers=headers, files={"file": ("take.wav", content, "audio/wav")}, data=data)

    assert post({"conceptId": "c_es_adios", "voice": "nobody"}).status_code == 422
    assert post({"voice": "mateo"}).status_code == 422
    assert post({"conceptId": "c_es_nope", "voice": "mateo"}).status_code == 404
    bad_pitch = post({"conceptId": "c_es_adios", "voice": "mateo", "pitch": '{"v":1,"hopMs":10,"st":[1],"x":1}'})
    assert bad_pitch.status_code == 422 and bad_pitch.json()["detail"]["code"] == "invalid_pitch"
    assert post({"conceptId": "c_es_adios", "voice": "mateo"}, b"ID3not audio at all").status_code == 415
    too_big = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * (2 * 1024 * 1024)
    assert post({"conceptId": "c_es_adios", "voice": "mateo"}, too_big).status_code == 413
    learner = editor(aclient, "teacher")
    assert aclient.post(url, headers=learner, data={"voice": "mateo"}).status_code == 403

    # Chemin explicite (ex. audio d'une carte culture) : pas de mise à jour de concept.
    res = post({"path": "audio/cc_es_saludos.opus", "voice": "lucia_mx_f"})
    assert res.status_code == 200, res.text
    assert [f["path"] for f in res.json()["files"]] == [
        "audio/cc_es_saludos.opus",
        "audio/cc_es_saludos.m4a",
        "audio/cc_es_saludos_slow.opus",
        "audio/cc_es_saludos_slow.m4a",
    ]
    assert res.json()["pitch"] is None
    assert post({"path": "../pack", "voice": "mateo"}).status_code == 422


def test_pitch_reference_parser_matches_core() -> None:
    ref = {"v": 1, "hopMs": 10, "st": [0.3, 0.3, None, -0.5], "syllables": [{"start": 0, "end": 30, "tone": "sac"}]}
    assert parse_pitch_reference(json.dumps(ref)) == ref
    bad: list[Any] = [
        "not json",
        None,
        [],
        {**ref, "v": 2},
        {**ref, "extra": True},
        {**ref, "hopMs": 0},
        {**ref, "st": []},
        {**ref, "st": [None, None]},
        {**ref, "st": [1, "2"]},
        {**ref, "st": [1, 1e9]},
        {**ref, "syllables": [{"start": 0, "end": 90, "tone": "sac"}]},
        {**ref, "syllables": [{"start": 20, "end": 10, "tone": "sac"}]},
        {**ref, "syllables": [{"start": 0, "end": 20, "tone": "up"}]},
        {**ref, "syllables": [{"start": 0, "end": 20, "tone": "sac", "x": 1}]},
        {**ref, "syllables": [{"start": 0, "end": 30, "tone": "sac"}, {"start": 20, "end": 40, "tone": "nang"}]},
        {**ref, "v": True},
    ]
    for value in bad:
        with pytest.raises(ValueError):
            parse_pitch_reference(value if isinstance(value, str) else json.dumps(value))
    assert serialize_pitch_reference({"v": 1, "hopMs": 10.0, "st": [1.0, -0.04, 0.25, None]}) == (
        '{"v":1,"hopMs":10,"st":[1,0,0.3,null]}'
    )
