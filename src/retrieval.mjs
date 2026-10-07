const STOP = new Set('a an the to of and or for in on how do i my our we with is are can it this what does should use using'.split(' '));
const ALIASES = { tracking: ['instrumentation', 'track'], instrument: ['instrumentation'], retries: ['retry'], cost: ['costs', 'pricing', 'limits'], billing: ['pricing', 'limits'], install: ['setup', 'quickstart'], javascript: ['http', 'api'], csharp: ['http', 'api'], location: ['level', 'track'], existing: ['audit', 'expand'] };
function tokens(s) { return s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []; }
export function search(catalog, query, limit = 5, section) {
  const original = [...new Set(tokens(query).filter(t => !STOP.has(t)))].slice(0, 40);
  if (!original.length) return [];
  const terms = [...new Set(original.flatMap(t => [t, ...t.split('_'), ...(ALIASES[t] || [])]))];
  const corpus = catalog.documents.map(d => ({ d, title: tokens(d.title + ' ' + d.id), body: tokens(d.content), section: tokens(d.section_title) }));
  const frequency = new Map(terms.map(t => [t, corpus.filter(x => x.title.includes(t) || x.body.includes(t)).length]));
  return corpus.filter(x => !section || x.d.section === section).map(x => {
    let score = 0;
    for (const term of terms) {
      const tf = x.body.filter(t => t === term).length;
      const idf = Math.log(1 + corpus.length / (1 + frequency.get(term)));
      score += idf * (x.title.includes(term) ? 7 : 0);
      score += idf * (x.section.includes(term) ? 1 : 0);
      score += idf * tf / (tf + 1.2 * (0.25 + 0.75 * x.body.length / 250));
    }
    if (x.d.content.toLowerCase().includes(query.toLowerCase())) score += 8;
    const idx = original.map(t => x.d.content.toLowerCase().indexOf(t)).filter(i => i >= 0).sort((a, b) => a-b)[0] ?? 0;
    const start = Math.max(0, idx-100);
    return { id: x.d.id, title: x.d.title, section: x.d.section, section_title: x.d.section_title, url: x.d.url, revision: x.d.revision, snippet: (start ? '…' : '') + x.d.content.slice(start, start+500) + (x.d.content.length > start+500 ? '…' : ''), score };
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id)).slice(0, limit).map(({ score, ...result }) => result);
}
export function getDoc(catalog, { id, offset = 0, max_chars = 12000, revision }) {
  const doc = catalog.documents.find(d => d.id === id);
  if (!doc) throw new Error('Unknown document ID. Use search_docs or the docs index to find a valid ID.');
  if (revision && revision !== doc.revision) throw new Error('Document changed since the previous page. Restart at offset 0 without a revision.');
  if (offset >= doc.content.length && offset !== 0) throw new Error('Offset is outside this document.');
  const end = Math.min(doc.content.length, offset + max_chars);
  return { ...doc, content: doc.content.slice(offset, end), offset, total_chars: doc.content.length, next_offset: end < doc.content.length ? end : null };
}
