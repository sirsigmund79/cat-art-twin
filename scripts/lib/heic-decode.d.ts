declare module 'heic-decode' {
  interface DecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  export default function decode(opts: { buffer: Buffer | ArrayBuffer | Uint8Array }): Promise<DecodedImage>;
}
