// iPhones save photos as HEIC. Safari decodes it natively; Chrome and Firefox on Windows and Android
// don't. For those, convert to JPEG with heic-to (libheif in WebAssembly), loaded only when needed
// since it is about 3 MB.

/** ISO-BMFF brands used by HEIC/HEIF files ("ftyp" box at byte 4, major brand at byte 8). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

async function isHeif(file: File): Promise<boolean> {
  if (/image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  return head.length === 12 && ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12));
}

async function browserCanDecode(file: Blob): Promise<boolean> {
  try {
    (await createImageBitmap(file)).close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns an image the browser can display: the file itself, or a JPEG converted from HEIC.
 * `onConverting` is called before a (slower) conversion starts, to show progress.
 */
export async function toBrowserImage(file: File, onConverting: () => void): Promise<Blob> {
  if (await browserCanDecode(file)) return file;
  if (!(await isHeif(file))) {
    throw new Error("your browser can't open this image format. Try a JPEG or PNG");
  }
  onConverting();
  const { heicTo } = await import('heic-to');
  // libheif applies the photo's stored rotation, so the JPEG comes out upright.
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
}
