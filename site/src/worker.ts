// Runs CLIP's vision tower off the main thread. Only the vision model is downloaded:
// the two text embeddings the scorer needs are precomputed in meta.json.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers';
import { CLIP_DTYPE, CLIP_MODEL } from '../../shared/config.ts';

env.allowLocalModels = false;

export type WorkerRequest = { type: 'load' } | { type: 'embed'; id: number; image: Blob };
export type WorkerResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'embedding'; id: number; vector: Float32Array }
  | { type: 'error'; id?: number; message: string };

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

type Model = Awaited<ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained>>;
type Processor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
let loading: Promise<{ model: Model; processor: Processor }> | null = null;

const files = new Map<string, { loaded: number; total: number }>();
function onProgress(p: { status: string; file?: string; loaded?: number; total?: number }) {
  if (p.status !== 'progress' || !p.file) return;
  files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
  let loaded = 0;
  let total = 0;
  for (const f of files.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  post({ type: 'progress', loaded, total });
}

async function embed(model: Model, processor: Processor, image: RawImage): Promise<Float32Array> {
  const inputs = await processor(image);
  const { image_embeds } = await model(inputs);
  return new Float32Array(image_embeds.data as Float32Array);
}

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load() {
  const processor = await AutoProcessor.from_pretrained(CLIP_MODEL);
  const devices = (await hasWebGPU()) ? (['webgpu', 'wasm'] as const) : (['wasm'] as const);
  let lastError: unknown;
  for (const device of devices) {
    try {
      const model = await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, {
        device,
        dtype: CLIP_DTYPE,
        progress_callback: onProgress,
      });
      // Some quantized ops are missing on some WebGPU drivers; a warm-up run surfaces that now.
      const blank = new RawImage(new Uint8ClampedArray(32 * 32 * 3).fill(128), 32, 32, 3);
      await embed(model, processor, blank);
      post({ type: 'ready', device });
      return { model, processor };
    } catch (err) {
      console.warn(`CLIP on ${device} failed, trying the next backend`, err);
      lastError = err;
    }
  }
  throw lastError;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    loading ??= load();
    const { model, processor } = await loading;
    if (msg.type === 'embed') {
      const vector = await embed(model, processor, await RawImage.fromBlob(msg.image));
      post({ type: 'embedding', id: msg.id, vector }, [vector.buffer]);
    }
  } catch (err) {
    if (msg.type === 'load') loading = null;
    post({ type: 'error', id: msg.type === 'embed' ? msg.id : undefined, message: String((err as Error)?.message ?? err) });
  }
};
