// The local, no-AI check for possible identifiers. Runs on the phone only.
// It is loose on purpose: it suggests, the author decides, nothing is blocked.
// Lists live in /lists/ (first names minus everyday words; local companies).

export const HINT = 'You might have named or identified someone here. Consider rephrasing if so.';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createChecker({ firstNames = [], companies = [] }) {
  const names = new Set(firstNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const companyPatterns = companies
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c && !c.startsWith('#'))
    .map((c) => ({ c, re: new RegExp(`(^|[^\\p{L}\\p{N}])${escape(c)}($|[^\\p{L}\\p{N}])`, 'u') }));

  // Returns the words that look like identifiers (empty when nothing found).
  return function check(text) {
    const hits = new Set();
    const lower = (text ?? '').toLowerCase();
    for (const [word] of lower.matchAll(/\p{L}[\p{L}'’-]*/gu)) {
      const base = word.replace(/['’]s$/, '');
      if (names.has(base)) hits.add(base);
    }
    for (const { c, re } of companyPatterns) if (re.test(lower)) hits.add(c);
    for (const [m] of lower.matchAll(/@[\w.]+|[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/\S+|\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/g)) hits.add(m);
    return [...hits];
  };
}

export async function loadChecker() {
  const get = async (path) => {
    try {
      const res = await fetch(path);
      return res.ok ? (await res.text()).split('\n') : [];
    } catch {
      return [];
    }
  };
  const [firstNames, companies] = await Promise.all([get('/lists/first-names.txt'), get('/lists/companies.txt')]);
  return createChecker({ firstNames, companies });
}
