import type { CardDraft } from './types';


export function parseDelimited(text: string): CardDraft[] {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('Dấu ngoặc kép chưa đóng.');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  const first = rows[0]?.map(v => v.trim().toLowerCase()) || [];
  const header = first.includes('term') || first.includes('definition') || first.includes('từ') || first.includes('nghĩa') || first.includes('word') || first.includes('meaning');
  const cols = header ? first : ['term', 'definition', 'phonetic', 'example', 'example_translation', 'notes'];
  return rows.slice(header ? 1 : 0).map(r => {
    const get = (...names: string[]) => { const i = cols.findIndex(c => names.includes(c)); return i >= 0 ? (r[i] || '').trim() : ''; };
    return { term: get('term', 'từ', 'word'), definition: get('definition', 'nghĩa', 'meaning'), phonetic: get('phonetic', 'ipa', 'phiên âm'), example: get('example', 'ví dụ'), example_translation: get('example_translation'), notes: get('notes', 'ghi chú'), synonyms: get('synonyms'), antonyms: get('antonyms') };
  }).filter(r => r.term || r.definition);
}

/** Separators offered by Quizlet's "Import" dialog. `custom` uses the accompanying string. */
export type TermSeparator = 'tab' | 'comma' | 'custom';
export type CardSeparator = 'newline' | 'semicolon' | 'custom';
export type ImportOptions = { term: TermSeparator; card: CardSeparator; customTerm?: string; customCard?: string };

/** Parse text pasted into the import box exactly like Quizlet: split into cards, then split each card once into term/definition. */
export function parseImport(text: string, options: ImportOptions): { term: string; definition: string }[] {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const unescape = (value = '') => value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const termSep = options.term === 'tab' ? '\t' : options.term === 'comma' ? ',' : unescape(options.customTerm);
  const cardSep = options.card === 'newline' ? '\n' : options.card === 'semicolon' ? ';' : unescape(options.customCard);
  if (!termSep || !cardSep) return [];
  return source.split(cardSep).filter(chunk => chunk.trim()).map(chunk => {
    const at = chunk.indexOf(termSep);
    return at < 0 ? { term: chunk.trim(), definition: '' } : { term: chunk.slice(0, at).trim(), definition: chunk.slice(at + termSep.length).trim() };
  });
}
