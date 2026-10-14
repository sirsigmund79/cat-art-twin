// Which works count as historical (made before HISTORICAL_BEFORE). Dates come in many shapes
// ("ca. 1850", "1890-95", "19th century", "2015-06-01 10:00:00"), and many are missing.
import { HISTORICAL_BEFORE } from '../../shared/config.ts';
import type { ArtworkRecord, ScoreRecord, Source } from './types.ts';

/** Sources whose undated items are still historical: museum collections and digitized old books. */
const OLD_SOURCES = new Set<Source>(['met', 'aic', 'cma', 'wikidata', 'bhl']);
/** For undated items elsewhere: CLIP's probability that the image looks old (see ERA_PROMPTS). */
export const OLD_LOOK_MIN = 0.5;

/** Best-guess year from a free-text date; centuries map to their middle. Null if none found. */
export function parseYear(date: string | undefined): number | null {
  if (!date) return null;
  const century = /\b(\d{1,2})(?:st|nd|rd|th)[ -]century\b/i.exec(date);
  const year = /\b(1\d{3}|20\d{2}|[1-9]\d{2})\b/.exec(date);
  if (year && (!century || year.index < century.index)) return Number(year[1]);
  if (century) return (Number(century[1]) - 1) * 100 + 50;
  return null;
}

export function isHistorical(rec: Pick<ArtworkRecord, 'source' | 'date'> | undefined, score: ScoreRecord | undefined): boolean {
  if (!rec) return false;
  const year = parseYear(rec.date);
  if (year !== null) return year < HISTORICAL_BEFORE;
  if (OLD_SOURCES.has(rec.source)) return true;
  return (score?.old ?? 0) >= OLD_LOOK_MIN;
}
