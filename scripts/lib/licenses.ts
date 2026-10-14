// Which licenses the site accepts, and short labels for credits.
// Allowed: public domain, CC0 and CC licenses BY, BY-SA, BY-NC, BY-NC-SA.
// Refused: anything NoDerivatives (cropping is a derivative), all-rights-reserved and unknown terms.

export interface License {
  label: string;
  url: string;
}

const CC_RE = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/(\d\.\d)?/i;
const ALLOWED_CC = new Set(['by', 'by-sa', 'by-nc', 'by-nc-sa']);

/**
 * Normalize a license from its URL and/or name. Returns null when it isn't one the site accepts.
 * Examples: ("https://creativecommons.org/licenses/by-nc/2.0/") -> CC BY-NC 2.0;
 *           (undefined, "Public domain") -> Public domain.
 */
export function normalizeLicense(url?: string | null, name?: string | null): License | null {
  const u = (url ?? '').trim();
  const n = (name ?? '').trim();
  const m = CC_RE.exec(u);
  if (m) {
    const [, kind, code, version] = m;
    const cleanUrl = `https://creativecommons.org/${kind.toLowerCase()}/${code.toLowerCase()}/${version ? `${version}/` : ''}`;
    if (kind.toLowerCase() === 'publicdomain') {
      if (code.toLowerCase() === 'zero') return { label: 'CC0', url: cleanUrl };
      if (code.toLowerCase() === 'mark') return { label: 'Public domain', url: cleanUrl };
      return null;
    }
    if (!ALLOWED_CC.has(code.toLowerCase())) return null;
    return { label: `CC ${code.toUpperCase()}${version ? ` ${version}` : ''}`, url: cleanUrl };
  }
  // Named licenses without a usable URL.
  if (/no\s*deriv|\bnd\b|-nd\b/i.test(n)) return null;
  if (/^(cc0|cc-zero)/i.test(n) || /public domain dedication/i.test(n)) {
    return { label: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' };
  }
  if (/public domain|^pd\b|^pd-|no known copyright|united states government work/i.test(n)) {
    return { label: 'Public domain', url: u };
  }
  const named = /^cc[ -](by(?:-nc)?(?:-sa)?)(?:[ -](\d\.\d))?/i.exec(n);
  if (named && ALLOWED_CC.has(named[1].toLowerCase())) {
    const code = named[1].toLowerCase();
    const version = named[2] ?? '4.0';
    return { label: `CC ${code.toUpperCase()} ${version}`, url: `https://creativecommons.org/licenses/${code}/${version}/` };
  }
  return null;
}
