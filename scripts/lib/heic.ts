// sharp's prebuilt binaries can't decode HEIC (iPhone photos), so decode those with libheif
// (via heic-decode) and hand sharp raw pixels instead.
import fs from 'node:fs';
import decode from 'heic-decode';
import sharp, { type Sharp } from 'sharp';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

export function isHeif(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp' && HEIF_BRANDS.has(buf.toString('latin1', 8, 12));
}

/**
 * Read a photo into an upright JPEG buffer at most `maxSide` px, decoding HEIC/HEIF too.
 * Upright matters: phone JPEGs often store rotation as an EXIF flag, and the detector and the
 * cropper must see the same orientation.
 */
export async function readUprightImage(file: string, maxSide = 1600): Promise<Buffer> {
  const buf = fs.readFileSync(file);
  let img: Sharp;
  if (isHeif(buf)) {
    // libheif applies the photo's stored rotation itself.
    const { width, height, data } = await decode({ buffer: buf });
    img = sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } });
  } else {
    img = sharp(buf).rotate();
  }
  return img
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 95 })
    .toBuffer();
}
