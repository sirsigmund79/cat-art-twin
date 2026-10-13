import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import './style.css';
import { DEFAULT_SCORING } from '../../shared/config.ts';
import { dominantColors } from '../../shared/palette.ts';
import { rank, type Match } from '../../shared/score.ts';
import type { MetaItem } from '../../shared/types.ts';
import { Clip } from './clip.ts';
import { loadArtData, type ArtData } from './data.ts';
import { canvasToBlob, renderShareCard } from './share.ts';

const TOP_K = 10;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const sections = { pick: $('pick'), crop: $('crop'), result: $('result') };
function show(name: keyof typeof sections) {
  for (const [k, el] of Object.entries(sections)) el.hidden = k !== name;
  $('error').hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showError(message: string) {
  const el = $('error');
  el.textContent = message;
  el.hidden = false;
}

// ---------- Model and data, both start loading immediately ----------
const progress = $<HTMLProgressElement>('model-progress');
const modelLabel = $('model-label');
const clip = new Clip((loaded, total) => {
  if (!total) return;
  progress.value = loaded / total;
  modelLabel.textContent = `Loading the matching model… ${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB`;
});
clip.ready.then(
  () => {
    progress.value = 1;
    modelLabel.textContent = 'Ready.';
    document.body.dataset.modelReady = 'true';
  },
  (err) => {
    modelLabel.textContent = 'The matching model failed to load.';
    showError(`Could not load the model: ${err.message}. Try reloading the page.`);
  },
);

const dataPromise: Promise<ArtData | null> = loadArtData();
dataPromise.then(
  (data) => {
    if (!data) {
      $('gallery-section').hidden = true;
      showError('The art index has not been built yet (run the pipeline, then npm run build).');
      return;
    }
    renderGallery(data.meta.items);
  },
  (err) => showError(`Could not load the art index: ${err.message}`),
);

function renderGallery(items: MetaItem[]) {
  const starred = items.filter((i) => i.starred);
  const pick = (starred.length >= 6 ? starred : items).slice(0, 24);
  $('gallery').replaceChildren(
    ...pick.map((item) => {
      const a = document.createElement('a');
      a.href = item.objectUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = [item.title, item.artist, item.date].filter(Boolean).join(', ');
      const img = document.createElement('img');
      img.src = item.crop;
      img.alt = item.title;
      img.loading = 'lazy';
      a.append(img);
      return a;
    }),
  );
}

// ---------- Pick and crop ----------
let cropper: Cropper | null = null;
let photoUrl: string | null = null;
const cropImg = $<HTMLImageElement>('crop-img');

$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = URL.createObjectURL(file);
  cropper?.destroy();
  cropImg.src = photoUrl;
  show('crop');
  cropImg.onload = () => {
    cropper = new Cropper(cropImg, {
      viewMode: 1,
      autoCropArea: 0.9,
      zoomable: false,
      // Browsers already apply EXIF orientation to <img>; don't rotate twice.
      checkOrientation: false,
      background: false,
    });
  };
  (e.target as HTMLInputElement).value = '';
});

$('crop-back').addEventListener('click', () => $('file').click());
$('again').addEventListener('click', () => $('file').click());

// ---------- Match ----------
let matches: Match[] = [];
let current = 0;
let catCanvas: HTMLCanvasElement | null = null;
let items: MetaItem[] = [];

function paletteOfCanvas(canvas: HTMLCanvasElement) {
  const s = Math.min(1, 224 / Math.max(canvas.width, canvas.height));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(canvas.width * s));
  small.height = Math.max(1, Math.round(canvas.height * s));
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return dominantColors(ctx.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
}

$('find').addEventListener('click', async () => {
  if (!cropper) return;
  const button = $<HTMLButtonElement>('find');
  button.disabled = true;
  button.textContent = 'Searching the museums…';
  try {
    catCanvas = cropper.getCroppedCanvas({ maxWidth: 1024, maxHeight: 1024, imageSmoothingQuality: 'high' });
    const [data, embedding] = await Promise.all([dataPromise, clip.embed(await canvasToBlob(catCanvas, 'image/jpeg'))]);
    if (!data) throw new Error('the art index has not been built yet');
    items = data.meta.items;
    matches = rank(embedding, data.index, {
      ...DEFAULT_SCORING,
      topK: TOP_K,
      textPhoto: data.meta.textPhoto,
      textPainting: data.meta.textPainting,
      photoPalette: paletteOfCanvas(catCanvas),
      palettes: items.map((i) => i.colors),
    });
    const yours = $<HTMLCanvasElement>('your-cat');
    yours.width = catCanvas.width;
    yours.height = catCanvas.height;
    yours.getContext('2d')!.drawImage(catCanvas, 0, 0);
    current = 0;
    renderMatch();
    show('result');
  } catch (err) {
    showError(`Matching failed: ${(err as Error).message}`);
  } finally {
    button.disabled = false;
    button.textContent = "Find my cat's twin";
  }
});

function renderMatch() {
  const item = items[matches[current].index];
  $<HTMLImageElement>('twin-img').src = item.crop;
  $<HTMLImageElement>('twin-img').alt = item.title;
  $('twin-rank').textContent = current === 0 ? 'Art twin' : `Match #${current + 1}`;
  $('twin-title').textContent = item.title;
  $('twin-byline').textContent = [item.artist, item.date].filter(Boolean).join(', ');
  $('twin-license').textContent = item.license;
  $('twin-museum').textContent = item.museum;
  $<HTMLAnchorElement>('twin-link').href = item.objectUrl;
  $<HTMLButtonElement>('prev-match').disabled = current === 0;
  $<HTMLButtonElement>('next-match').disabled = current >= matches.length - 1;
  $('next-match').textContent = `See the next match (${Math.min(current + 2, matches.length)}/${matches.length}) ›`;
}

$('next-match').addEventListener('click', () => {
  current = Math.min(current + 1, matches.length - 1);
  renderMatch();
});
$('prev-match').addEventListener('click', () => {
  current = Math.max(current - 1, 0);
  renderMatch();
});

// ---------- Share ----------
async function shareBlob(): Promise<{ blob: Blob; item: MetaItem }> {
  const item = items[matches[current].index];
  const card = await renderShareCard(catCanvas!, item);
  card.id = 'share-card';
  document.getElementById('share-card')?.remove();
  card.hidden = true;
  document.body.append(card);
  return { blob: await canvasToBlob(card), item };
}

$('download').addEventListener('click', async () => {
  const { blob } = await shareBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cat-art-twin.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
});

$('share').addEventListener('click', async () => {
  const { blob, item } = await shareBlob();
  const file = new File([blob], 'cat-art-twin.png', { type: 'image/png' });
  const text = `My cat's art twin: ${item.title}${item.artist ? ` by ${item.artist}` : ''} (${item.museum})`;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, url: location.href });
    } catch {
      // The visitor closed the share sheet.
    }
  } else {
    $('download').click();
  }
});
