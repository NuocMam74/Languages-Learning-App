/**
 * Image carrée de partage d'un certificat (spec §5.5 : « publicité gratuite »).
 * Générée côté client sur un canvas 1080×1080, palette §13, serif pour le vietnamien.
 */

export const PALETTE = {
  nuoc: "#F2F6F3",
  muc: "#14201E",
  ngoc: "#0E5E55",
  sonMai: "#C2352A",
  nghe: "#E5A21B",
  phuSa: "#3A3A34",
} as const;

export const SERIF = '"Source Serif 4 Variable", Georgia, serif';
export const SANS = '"Be Vietnam Pro", system-ui, sans-serif';
export const SHARE_SIZE = 1080;

export interface CertificateImageInput {
  displayName: string;
  level: string;
  /** Nom du certificat sans le niveau, ex. « Bén rễ ». */
  name: string;
  issuedAt: string;
  code: string;
  verifyUrl: string;
  labels: { awarded: string; tagline: string; verify: string };
  locale: string;
}

export async function fontsReady(): Promise<void> {
  if (!("fonts" in document)) return;
  await Promise.all(
    [`600 96px ${SERIF}`, `italic 400 96px ${SERIF}`, `400 30px ${SANS}`, `600 30px ${SANS}`].map((f) => document.fonts.load(f, "Bén rễ Nguyễn Ạ").catch(() => [])),
  );
}

/** Taille de police qui fait tenir `text` dans `maxWidth`. */
export function fit(ctx: CanvasRenderingContext2D, text: string, font: (size: number) => string, size: number, maxWidth: number, min = 28): number {
  let s = size;
  ctx.font = font(s);
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = font(s);
  }
  return s;
}

export function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

/** Trois lignes d'eau, discrètes : le fleuve, sans dégradé. */
export function waves(ctx: CanvasRenderingContext2D, y: number, width: number, left: number) {
  ctx.save();
  ctx.strokeStyle = PALETTE.ngoc;
  ctx.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    ctx.globalAlpha = 0.18 - k * 0.05;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 6) {
      const yy = y + k * 16 + Math.sin((x / width) * Math.PI * 4 + k * 0.9) * 6;
      if (x === 0) ctx.moveTo(left + x, yy);
      else ctx.lineTo(left + x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCertificate(ctx: CanvasRenderingContext2D, input: CertificateImageInput): void {
  const S = SHARE_SIZE;
  const cx = S / 2;
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = PALETTE.nuoc;
  ctx.fillRect(0, 0, S, S);

  // Double filet jade, losanges curcuma aux angles.
  ctx.strokeStyle = PALETTE.ngoc;
  ctx.lineWidth = 3;
  ctx.strokeRect(56, 56, S - 112, S - 112);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(74, 74, S - 148, S - 148);
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.nghe;
  for (const [x, y] of [[74, 74], [S - 74, 74], [74, S - 74], [S - 74, S - 74]] as const) diamond(ctx, x, y, 10);

  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.ngoc;
  ctx.font = `600 46px ${SERIF}`;
  ctx.fillText("Parlo", cx, 172);
  ctx.fillStyle = PALETTE.phuSa;
  ctx.font = `400 28px ${SANS}`;
  ctx.fillText(`Chứng chỉ · ${input.labels.tagline}`, cx, 216);
  waves(ctx, 250, 360, cx - 180);

  // Le niveau et le nom vietnamien : l'objet visuel.
  ctx.fillStyle = PALETTE.muc;
  ctx.font = `600 190px ${SERIF}`;
  ctx.fillText(input.level, cx, 470);
  ctx.fillStyle = PALETTE.ngoc;
  const nameSize = fit(ctx, input.name, (s) => `italic 400 ${s}px ${SERIF}`, 104, S - 260);
  ctx.font = `italic 400 ${nameSize}px ${SERIF}`;
  ctx.fillText(input.name, cx, 590);

  // Filet et point curcuma.
  ctx.strokeStyle = PALETTE.phuSa;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 170, 650);
  ctx.lineTo(cx - 18, 650);
  ctx.moveTo(cx + 18, 650);
  ctx.lineTo(cx + 170, 650);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.nghe;
  diamond(ctx, cx, 650, 7);

  ctx.fillStyle = PALETTE.phuSa;
  ctx.font = `400 30px ${SANS}`;
  ctx.fillText(input.labels.awarded, cx, 716);
  ctx.fillStyle = PALETTE.muc;
  const holderSize = fit(ctx, input.displayName, (s) => `600 ${s}px ${SERIF}`, 72, S - 300);
  ctx.font = `600 ${holderSize}px ${SERIF}`;
  ctx.fillText(input.displayName, cx, 800);
  ctx.fillStyle = PALETTE.phuSa;
  ctx.font = `400 30px ${SANS}`;
  ctx.fillText(new Date(input.issuedAt).toLocaleDateString(input.locale, { day: "numeric", month: "long", year: "numeric" }), cx, 852);

  // Code de vérification, à gauche.
  ctx.textAlign = "left";
  ctx.fillStyle = PALETTE.muc;
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText(input.code, 116, 944);
  ctx.fillStyle = PALETTE.phuSa;
  const verify = input.labels.verify.replace("{url}", input.verifyUrl.replace(/^https?:\/\//, ""));
  const verifySize = fit(ctx, verify, (s) => `400 ${s}px ${SANS}`, 22, S - 420, 14);
  ctx.font = `400 ${verifySize}px ${SANS}`;
  ctx.fillText(verify, 116, 980);

  // Sceau de laque, à droite.
  const sx = S - 176;
  const sy = 930;
  ctx.fillStyle = PALETTE.sonMai;
  ctx.beginPath();
  ctx.arc(sx, sy, 66, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.nuoc;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, 54, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.nuoc;
  ctx.font = `600 44px ${SERIF}`;
  ctx.fillText(input.level, sx, sy + 15);
}

export async function renderCertificateImage(input: CertificateImageInput): Promise<Blob> {
  await fontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_SIZE;
  canvas.height = SHARE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d indisponible");
  drawCertificate(ctx, input);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Web Share API avec fichier si possible, sinon téléchargement. */
export async function shareImage(blob: Blob, filename: string, text: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && typeof nav.share === "function") {
    try {
      await nav.share({ files: [file], text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}
