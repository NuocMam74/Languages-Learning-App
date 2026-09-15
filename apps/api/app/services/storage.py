"""Stockage des fichiers générés (certificats PDF) : disque local en développement, S3 compatible en production."""

from pathlib import Path
from typing import Any, Protocol

from app.config import Settings


class FileStorage(Protocol):
    def save(self, key: str, data: bytes, content_type: str) -> None: ...

    def load(self, key: str) -> bytes | None: ...


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise ValueError(f"Clé de stockage invalide : {key}")
        return path

    def save(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def load(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.is_file() else None


class S3Storage:
    """Bucket S3 ou compatible (MinIO, Scaleway…). Identifiants : chaîne standard boto3 (variables AWS_*)."""

    def __init__(self, bucket: str, prefix: str = "", endpoint_url: str | None = None, region: str | None = None):
        import boto3

        self.bucket = bucket
        self.prefix = prefix
        self.client: Any = boto3.client("s3", endpoint_url=endpoint_url, region_name=region)

    def save(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self.prefix + key, Body=data, ContentType=content_type)

    def load(self, key: str) -> bytes | None:
        try:
            obj = self.client.get_object(Bucket=self.bucket, Key=self.prefix + key)
        except self.client.exceptions.NoSuchKey:
            return None
        body: bytes = obj["Body"].read()
        return body


def make_storage(settings: Settings) -> FileStorage:
    if settings.storage_backend == "s3":
        if not settings.s3_bucket:
            raise RuntimeError("STORAGE_BACKEND=s3 exige S3_BUCKET")
        return S3Storage(settings.s3_bucket, settings.s3_prefix, settings.s3_endpoint_url, settings.s3_region)
    return LocalStorage(settings.media_dir)
