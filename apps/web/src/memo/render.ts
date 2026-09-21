import type { MemoEntry, MemoSheet } from "@parlo/core";
import { PALETTE, SANS, SERIF } from "../certificates/share-image.ts";
import { getLocale, l, t, type MessageKey } from "../i18n/index.ts";
import { createPageCanvas, pageFromCanvas, PAGE_PX, PRINT_SCALE, type PdfPage } from "./pdf.ts";

/**
 * Mise en page d'une fiche mémoire sur des pages A4 (contrat phase23 §4).
 *
 * Un moteur de flux minuscule, et c'est volontaire : on empile des **blocs**, chacun sachant se
 * mesurer avant de se dessiner, et une page se coupe entre deux blocs — jamais au milieu d'un mot
 * et de sa traduction. Trois pages de code valent mieux qu'une bibliothèque de mise en page pour
 * un document dont on maîtrise entièrement le contenu.
 *
 * Le papier est blanc et le texte noir : une fiche s'imprime. Le thème sombre de l'application ne
 * s'applique pas ici — imprimer un aplat sombre vide une cartouche et ne se lit pas mieux.
 */

/**
 * Marge en **pixels d'impression** : 18 mm, de quoi perforer sans manger un mot.
 * 18 mm à 150 ppp = 18 / 25,4 × 150 ≈ 106 px. Écrite telle quelle : la convertir une seconde fois
 * par `PRINT_SCALE` la portait à 37 mm, et mangeait un bon tiers de chaque page — assez pour
 * pousser sur une deuxième feuille une fiche qui tenait sur une seule.
 */
const M = 106;
const CONTENT_WIDTH = PAGE_PX.width - M * 2;
/** Place réservée au pied de page (≈ 15 mm) : il ne doit jamais être recouvert par un bloc. */
const FOOTER_HEIGHT = 90;

const px = (value: number) => Math.round(value * PRINT_SCALE);

/** Un bloc sait ce qu'il occupe, puis se dessine. Mesuré et dessiné avec le même code. */
interface Block {
  /** Rester avec le bloc suivant : un titre de section seul en bas de page est une coupure ratée. */
  keepWithNext?: boolean;
  render: (ctx: CanvasRenderingContext2D, y: number, draw: boolean) => number;
}

/* --------------------------------------------------------------- Mesures */

/** Découpe un texte en lignes qui tiennent dans `width`, en coupant aux espaces. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (ctx.measureText(candidate).width <= width || line === "") line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Écrit un texte enveloppé et rend la hauteur consommée. `draw = false` : on ne fait que mesurer. */
function text(
  ctx: CanvasRenderingContext2D,
  content: string,
  options: { x: number; y: number; width: number; font: string; color: string; lineHeight: number; draw: boolean },
): number {
  ctx.font = options.font;
  const lines = wrap(ctx, content, options.width);
  if (options.draw) {
    ctx.fillStyle = options.color;
    ctx.textAlign = "left";
    lines.forEach((line, i) => ctx.fillText(line, options.x, options.y + options.lineHeight * (i + 0.8)));
  }
  return lines.length * options.lineHeight;
}

/* ---------------------------------------------------------------- Blocs */

function sectionTitle(label: string): Block {
  return {
    keepWithNext: true,
    render: (ctx, y, draw) => {
      const top = y + px(14);
      const height = text(ctx, label, { x: M, y: top, width: CONTENT_WIDTH, font: `600 ${px(15)}px ${SERIF}`, color: PALETTE.ngoc, lineHeight: px(21), draw });
      if (draw) {
        // Un filet jade dilué sous le titre : il sépare sans faire un cadre de plus.
        ctx.strokeStyle = PALETTE.ngoc;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = Math.max(1, px(1));
        ctx.beginPath();
        ctx.moveTo(M, top + height + px(5));
        ctx.lineTo(M + CONTENT_WIDTH, top + height + px(5));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      return px(14) + height + px(11);
    },
  };
}

/**
 * Un mot : la forme en serif à gauche, le sens à droite sur la même ligne de base quand il y a la
 * place, dessous sinon. Puis, en retrait, l'API, le registre, la remarque et les exemples.
 */
function entryBlock(entry: MemoEntry): Block {
  return {
    render: (ctx, y, draw) => {
      const viFont = `600 ${px(13)}px ${SERIF}`;
      const glossFont = `400 ${px(10)}px ${SANS}`;
      ctx.font = viFont;
      const viWidth = ctx.measureText(entry.vi).width;
      const gloss = l(entry.gloss);
      ctx.font = glossFont;
      const glossWidth = ctx.measureText(gloss).width;
      const sameLine = viWidth + glossWidth + px(16) <= CONTENT_WIDTH;

      let height = 0;
      if (draw) {
        ctx.font = viFont;
        ctx.fillStyle = PALETTE.muc;
        ctx.textAlign = "left";
        ctx.fillText(entry.vi, M, y + px(14));
      }
      if (sameLine) {
        if (draw) {
          ctx.font = glossFont;
          ctx.fillStyle = PALETTE.phuSa;
          ctx.textAlign = "right";
          ctx.fillText(gloss, M + CONTENT_WIDTH, y + px(14));
          ctx.textAlign = "left";
        }
        height = px(19);
      } else {
        height = px(19) + text(ctx, gloss, { x: M, y: y + px(19), width: CONTENT_WIDTH, font: glossFont, color: PALETTE.phuSa, lineHeight: px(14), draw });
      }

      // Ligne d'aide : API et registre, discrets, seulement s'ils existent.
      const aside = [entry.ipaSouth, entry.register ? t(`memo.register.${entry.register}` as MessageKey) : null].filter(Boolean).join(" · ");
      if (aside) height += text(ctx, aside, { x: M, y: y + height, width: CONTENT_WIDTH, font: `400 ${px(9)}px ${SANS}`, color: PALETTE.phuSa, lineHeight: px(13), draw });
      if (entry.note) {
        height += text(ctx, l(entry.note), { x: M, y: y + height, width: CONTENT_WIDTH, font: `400 ${px(9.5)}px ${SANS}`, color: PALETTE.phuSa, lineHeight: px(13), draw });
      }
      for (const example of entry.examples) {
        const indent = px(14);
        if (draw) {
          // Filet en marge de l'exemple : il se distingue de l'entrée sans changer de taille.
          ctx.strokeStyle = PALETTE.nghe;
          ctx.lineWidth = Math.max(1, px(2));
          ctx.beginPath();
          ctx.moveTo(M + px(3), y + height + px(3));
          ctx.lineTo(M + px(3), y + height + px(24));
          ctx.stroke();
        }
        height += text(ctx, example.vi, { x: M + indent, y: y + height, width: CONTENT_WIDTH - indent, font: `400 ${px(10.5)}px ${SERIF}`, color: PALETTE.muc, lineHeight: px(14), draw });
        height += text(ctx, l(example.translation), { x: M + indent, y: y + height, width: CONTENT_WIDTH - indent, font: `400 ${px(9.5)}px ${SANS}`, color: PALETTE.phuSa, lineHeight: px(13), draw });
      }
      return height + px(9);
    },
  };
}

/** Une phrase prête à dire : la forme, puis sa traduction juste dessous. */
function phraseBlock(vi: string, translation: string): Block {
  return {
    render: (ctx, y, draw) => {
      let height = text(ctx, vi, { x: M, y, width: CONTENT_WIDTH, font: `400 ${px(12)}px ${SERIF}`, color: PALETTE.muc, lineHeight: px(17), draw });
      height += text(ctx, translation, { x: M, y: y + height, width: CONTENT_WIDTH, font: `400 ${px(9.5)}px ${SANS}`, color: PALETTE.phuSa, lineHeight: px(13), draw });
      return height + px(8);
    },
  };
}

/** Un pense-bête : une pastille curcuma et une phrase. */
function bulletBlock(content: string): Block {
  return {
    render: (ctx, y, draw) => {
      const indent = px(13);
      if (draw) {
        ctx.fillStyle = PALETTE.nghe;
        ctx.beginPath();
        ctx.arc(M + px(3), y + px(8), px(2.6), 0, Math.PI * 2);
        ctx.fill();
      }
      return text(ctx, content, { x: M + indent, y, width: CONTENT_WIDTH - indent, font: `400 ${px(10.5)}px ${SANS}`, color: PALETTE.muc, lineHeight: px(15), draw }) + px(6);
    },
  };
}

/** Un encart : titre et corps sur un aplat curcuma très dilué (les cartes culture). */
function noteBlock(title: string, body: string): Block {
  return {
    render: (ctx, y, draw) => {
      const pad = px(10);
      const inner = CONTENT_WIDTH - pad * 2;
      let height = pad;
      height += text(ctx, title, { x: M + pad, y: y + height, width: inner, font: `600 ${px(11)}px ${SANS}`, color: PALETTE.muc, lineHeight: px(15), draw: false });
      height += text(ctx, body, { x: M + pad, y: y + height, width: inner, font: `400 ${px(10)}px ${SANS}`, color: PALETTE.phuSa, lineHeight: px(14), draw: false });
      height += pad;
      if (draw) {
        ctx.fillStyle = "#FBF1DD";
        ctx.beginPath();
        ctx.roundRect(M, y, CONTENT_WIDTH, height, px(8));
        ctx.fill();
        let inside = pad;
        inside += text(ctx, title, { x: M + pad, y: y + inside, width: inner, font: `600 ${px(11)}px ${SANS}`, color: PALETTE.muc, lineHeight: px(15), draw: true });
        text(ctx, body, { x: M + pad, y: y + inside, width: inner, font: `400 ${px(10)}px ${SANS}`, color: PALETTE.phuSa, lineHeight: px(14), draw: true });
      }
      return height + px(9);
    },
  };
}

/** Une réplique de dialogue : qui parle, ce qui se dit, ce que ça veut dire. */
function turnBlock(speaker: string, vi: string, translation: string): Block {
  return {
    render: (ctx, y, draw) => {
      let height = text(ctx, speaker, { x: M, y, width: CONTENT_WIDTH, font: `600 ${px(9)}px ${SANS}`, color: PALETTE.ngoc, lineHeight: px(12), draw });
      height += text(ctx, vi, { x: M + px(10), y: y + height, width: CONTENT_WIDTH - px(10), font: `400 ${px(11)}px ${SERIF}`, color: PALETTE.muc, lineHeight: px(16), draw });
      height += text(ctx, translation, { x: M + px(10), y: y + height, width: CONTENT_WIDTH - px(10), font: `400 ${px(9)}px ${SANS}`, color: PALETTE.phuSa, lineHeight: px(12), draw });
      return height + px(7);
    },
  };
}

/* -------------------------------------------------------------- Assemblage */

/** L'en-tête de la première page : le titre du niveau et son objectif. */
function headerBlock(sheet: MemoSheet, packName: string): Block {
  return {
    keepWithNext: true,
    render: (ctx, y, draw) => {
      let height = text(ctx, `Parlo · ${packName}`, { x: M, y, width: CONTENT_WIDTH, font: `600 ${px(9)}px ${SANS}`, color: PALETTE.ngoc, lineHeight: px(13), draw });
      height += px(4);
      height += text(ctx, l(sheet.title), { x: M, y: y + height, width: CONTENT_WIDTH, font: `600 ${px(21)}px ${SERIF}`, color: PALETTE.muc, lineHeight: px(28), draw });
      height += text(ctx, l(sheet.unitTitle), { x: M, y: y + height, width: CONTENT_WIDTH, font: `400 ${px(10)}px ${SANS}`, color: PALETTE.phuSa, lineHeight: px(15), draw });
      height += px(8);
      height += text(ctx, l(sheet.goal), { x: M, y: y + height, width: CONTENT_WIDTH, font: `400 ${px(11.5)}px ${SANS}`, color: PALETTE.muc, lineHeight: px(16), draw });
      if (draw) {
        ctx.strokeStyle = PALETTE.ngoc;
        ctx.lineWidth = Math.max(1, px(2));
        ctx.beginPath();
        ctx.moveTo(M, y + height + px(10));
        ctx.lineTo(M + px(48), y + height + px(10));
        ctx.stroke();
      }
      return height + px(20);
    },
  };
}

/** Tous les blocs d'une fiche, dans l'ordre de lecture. Une section vide ne pose pas son titre. */
function blocksOf(sheet: MemoSheet, packName: string): Block[] {
  const blocks: Block[] = [headerBlock(sheet, packName)];
  const section = (label: MessageKey, items: Block[]) => {
    if (items.length === 0) return;
    blocks.push(sectionTitle(t(label)), ...items);
  };

  section("memo.section.words", sheet.words.map(entryBlock));
  section("memo.section.structures", sheet.structures.map(entryBlock));
  section("memo.section.sounds", sheet.sounds.map(entryBlock));
  section("memo.section.phrases", sheet.phrases.map((phrase) => phraseBlock(phrase.vi, l(phrase.translation))));
  section("memo.section.tips", sheet.tips.map((tip) => bulletBlock(l(tip))));
  section(
    "memo.section.pitfalls",
    sheet.pitfalls.map((pitfall) => bulletBlock(`${t("memo.pitfall.line", { south: pitfall.vi, north: pitfall.north })} — ${l(pitfall.gloss)}`)),
  );
  section("memo.section.culture", sheet.culture.map((card) => noteBlock(l(card.title), [card.vi, l(card.body)].filter(Boolean).join(" — "))));
  section(
    "memo.section.dialogues",
    sheet.dialogues.flatMap((dialogue) => dialogue.turns.map((turn) => turnBlock(turn.speaker, turn.vi, l(turn.translation)))),
  );
  return blocks;
}

/** Pied de page : d'où vient la fiche et où l'on en est dedans. */
function drawFooter(ctx: CanvasRenderingContext2D, sheet: MemoSheet, index: number, total: number, madeOn: string): void {
  const y = PAGE_PX.height - Math.round(FOOTER_HEIGHT / 2);
  ctx.strokeStyle = PALETTE.phuSa;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = Math.max(1, px(1));
  ctx.beginPath();
  ctx.moveTo(M, y - px(10));
  ctx.lineTo(PAGE_PX.width - M, y - px(10));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = `400 ${px(8.5)}px ${SANS}`;
  ctx.fillStyle = PALETTE.phuSa;
  ctx.textAlign = "left";
  ctx.fillText(t("memo.pdf.footer", { unit: l(sheet.unitTitle), index, total }), M, y + px(6));
  ctx.textAlign = "right";
  ctx.fillText(madeOn, PAGE_PX.width - M, y + px(6));
  ctx.textAlign = "left";
}

/** Les polices utilisées par la fiche, chargées avant le premier `measureText`. */
async function fontsReady(): Promise<void> {
  if (!("fonts" in document)) return;
  const probes = [`600 ${px(21)}px ${SERIF}`, `400 ${px(12)}px ${SERIF}`, `400 ${px(10)}px ${SANS}`, `600 ${px(11)}px ${SANS}`];
  // Un échantillon à diacritiques empilés : si cette chaîne est composée, toute la fiche l'est.
  await Promise.all(probes.map((font) => document.fonts.load(font, "nghệ tiếng ở đâu").catch(() => [])));
}

/**
 * Compose la fiche en pages A4. Deux passes par bloc : on le mesure sur le contexte courant, et
 * s'il ne tient pas dans ce qui reste, on ouvre une page — puis on le dessine. Mesurer avec le
 * même code que celui qui dessine est la seule façon de ne jamais couper une entrée en deux.
 */
export async function renderMemoPages(sheet: MemoSheet, packName: string): Promise<PdfPage[]> {
  await fontsReady();
  const blocks = blocksOf(sheet, packName);
  const madeOn = t("memo.pdf.madeOn", { date: new Date().toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric" }) });
  const bottom = PAGE_PX.height - FOOTER_HEIGHT;

  const canvases: HTMLCanvasElement[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let y = 0;

  const newPage = () => {
    canvas = createPageCanvas();
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas 2d indisponible");
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = "alphabetic";
    ctx = context;
    canvases.push(canvas);
    y = M;
  };

  newPage();
  blocks.forEach((block, i) => {
    const context = ctx as CanvasRenderingContext2D;
    let needed = block.render(context, y, false);
    // Un titre de section ne reste jamais seul en bas de page : il emporte le bloc qui le suit.
    if (block.keepWithNext) needed += blocks[i + 1]?.render(context, y + needed, false) ?? 0;
    if (y + needed > bottom && y > M) newPage();
    y += block.render(ctx as CanvasRenderingContext2D, y, true);
  });

  canvases.forEach((page, i) => {
    const context = page.getContext("2d");
    if (context) drawFooter(context, sheet, i + 1, canvases.length, madeOn);
  });

  return Promise.all(canvases.map((page) => pageFromCanvas(page)));
}
