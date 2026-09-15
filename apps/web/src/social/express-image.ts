import { diamond, fit, fontsReady, PALETTE, SANS, SERIF, SHARE_SIZE, waves } from "../certificates/share-image.ts";

/**
 * Image carrée de partage du défi express (spec §5.2) : canvas 1080×1080,
 * palette §13, serif pour le nom du jeu et le score. Réutilise les outils du certificat.
 */

export interface ExpressImageInput {
  score: number;
  correct: number;
  /** Nom du jeu en vietnamien, ex. « Chợ nổi ». */
  gameName: string;
  displayName: string | null;
  date: string;
  locale: string;
  url: string;
  labels: { challenge: string; points: string; correct: string };
}

/** Barque stylisée (coque de laque, voile curcuma), sans dégradé. */
function boat(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const h = w * 0.22;
  ctx.save();
  ctx.fillStyle = PALETTE.sonMai;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x, y + h * 1.6, x + w / 2, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.nghe;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.05, y - 6);
  ctx.lineTo(x - w * 0.05, y - w * 0.42);
  ctx.lineTo(x + w * 0.26, y - 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawExpress(ctx: CanvasRenderingContext2D, input: ExpressImageInput): void {
  const S = SHARE_SIZE;
  const cx = S / 2;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = PALETTE.nuoc;
  ctx.fillRect(0, 0, S, S);

  // Filet jade, losanges curcuma (famille visuelle du certificat).
  ctx.strokeStyle = PALETTE.ngoc;
  ctx.lineWidth = 3;
  ctx.strokeRect(56, 56, S - 112, S - 112);
  ctx.fillStyle = PALETTE.nghe;
  for (const [x, y] of [[56, 56], [S - 56, 56], [56, S - 56], [S - 56, S - 56]] as const) diamond(ctx, x, y, 10);

  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.ngoc;
  ctx.font = `600 46px ${SERIF}`;
  ctx.fillText("Parlo", cx, 170);
  ctx.fillStyle = PALETTE.phuSa;
  ctx.font = `400 30px ${SANS}`;
  ctx.fillText(input.labels.challenge, cx, 218);

  // Le nom du jeu : l'objet visuel.
  ctx.fillStyle = PALETTE.ngoc;
  const nameSize = fit(ctx, input.gameName, (s) => `italic 400 ${s}px ${SERIF}`, 120, S - 260);
  ctx.font = `italic 400 ${nameSize}px ${SERIF}`;
  ctx.fillText(input.gameName, cx, 360);

  // Score.
  ctx.fillStyle = PALETTE.muc;
  const scoreText = String(input.score);
  const scoreSize = fit(ctx, scoreText, (s) => `600 ${s}px ${SERIF}`, 260, S - 300, 120);
  ctx.font = `600 ${scoreSize}px ${SERIF}`;
  ctx.fillText(scoreText, cx, 610);
  ctx.fillStyle = PALETTE.phuSa;
  ctx.font = `400 40px ${SANS}`;
  ctx.fillText(input.labels.points, cx, 670);
  ctx.font = `400 30px ${SANS}`;
  ctx.fillText(input.labels.correct, cx, 716);

  waves(ctx, 790, 560, cx - 280);
  boat(ctx, cx + 150, 800, 150);

  if (input.displayName) {
    ctx.fillStyle = PALETTE.muc;
    const holder = fit(ctx, input.displayName, (s) => `600 ${s}px ${SERIF}`, 52, S - 300);
    ctx.font = `600 ${holder}px ${SERIF}`;
    ctx.fillText(input.displayName, cx, 905);
  }
  ctx.fillStyle = PALETTE.phuSa;
  ctx.font = `400 26px ${SANS}`;
  const date = new Date(input.date).toLocaleDateString(input.locale, { day: "numeric", month: "long", year: "numeric" });
  const footer = `${date} · ${input.url.replace(/^https?:\/\//, "")}`;
  const footerSize = fit(ctx, footer, (s) => `400 ${s}px ${SANS}`, 26, S - 240, 14);
  ctx.font = `400 ${footerSize}px ${SANS}`;
  ctx.fillText(footer, cx, 960);
}

export async function renderExpressImage(input: ExpressImageInput): Promise<Blob> {
  await fontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_SIZE;
  canvas.height = SHARE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d indisponible");
  drawExpress(ctx, input);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}
