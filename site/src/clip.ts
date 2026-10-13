import type { WorkerRequest, WorkerResponse } from './worker.ts';

/** Main-thread handle on the CLIP worker. */
export class Clip {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>();
  readonly ready: Promise<string>;

  constructor(onProgress: (loaded: number, total: number) => void) {
    let resolveReady!: (device: string) => void;
    let rejectReady!: (e: Error) => void;
    this.ready = new Promise((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress(msg.loaded, msg.total);
      else if (msg.type === 'ready') resolveReady(msg.device);
      else if (msg.type === 'embedding') {
        this.pending.get(msg.id)?.resolve(msg.vector);
        this.pending.delete(msg.id);
      } else if (msg.type === 'error') {
        if (msg.id === undefined) rejectReady(new Error(msg.message));
        else {
          this.pending.get(msg.id)?.reject(new Error(msg.message));
          this.pending.delete(msg.id);
        }
      }
    };
    this.send({ type: 'load' });
  }

  private send(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  embed(image: Blob): Promise<Float32Array> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: 'embed', id, image });
    });
  }
}
