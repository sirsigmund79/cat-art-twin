import sharp from 'sharp';
import { dominantColors } from '../../shared/palette.ts';
import type { PaletteColor } from '../../shared/types.ts';

/** Palette of an image file. The browser samples a 224px canvas, so sample at the same size here. */
export async function paletteOfFile(file: string | Buffer): Promise<PaletteColor[]> {
  const { data, info } = await sharp(file)
    .resize(224, 224, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return dominantColors(data, info.width, info.height);
}
