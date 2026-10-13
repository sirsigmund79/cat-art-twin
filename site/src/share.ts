import type { MetaItem } from '../../shared/types.ts';

const W = 1200;
const H = 760;
const PAD = 40;
const CAPTION_H = 150;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** Draw `src` to fit inside the box, centered, with a thin frame. */
function drawFitted(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / sw, h / sh);
  const dw = sw * s;
  const dh = sh * s;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(dx - 6, dy - 6, dw + 12, dh + 12);
  ctx.drawImage(src, dx, dy, dw, dh);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Side-by-side share card: the visitor's cat and its art twin, with caption and museum credit. */
export async function renderShareCard(cat: HTMLCanvasElement, art: MetaItem): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f6f1e7';
  ctx.fillRect(0, 0, W, H);

  const artImg = await loadImage(art.crop);
  const panelW = (W - PAD * 3) / 2;
  const panelH = H - PAD * 2 - CAPTION_H;
  drawFitted(ctx, cat, cat.width, cat.height, PAD, PAD, panelW, panelH);
  drawFitted(ctx, artImg, artImg.naturalWidth, artImg.naturalHeight, PAD * 2 + panelW, PAD, panelW, panelH);

  const y = H - CAPTION_H + 10;
  ctx.fillStyle = '#2b2118';
  ctx.textBaseline = 'top';
  ctx.font = '600 30px Georgia, serif';
  ctx.fillText(fitText(ctx, `My cat's art twin: ${art.title}`, W - PAD * 2), PAD, y);
  ctx.font = '22px Georgia, serif';
  ctx.fillStyle = '#5a4a3a';
  const byline = [art.artist, art.date].filter(Boolean).join(', ');
  ctx.fillText(fitText(ctx, byline, W - PAD * 2), PAD, y + 44);
  ctx.fillText(fitText(ctx, `${art.museum} · public domain`, W - PAD * 2), PAD, y + 76);
  ctx.font = '18px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(location.host || 'cat-art-twin', W - PAD, H - 34);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas export failed'))), type, 0.92),
  );
}
