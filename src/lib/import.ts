import type { Card } from './types';
type CardDraft = Pick<Card, 'term' | 'definition' | 'phonetic' | 'example' | 'example_translation' | 'notes' | 'synonyms' | 'antonyms'>;

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

export type PasteSeparator = 'auto' | 'tab' | 'comma' | 'dash' | 'colon';

/** Parse the two-column list copied from Quizlet's import box. */
export function parseQuizletPaste(text: string, separator: PasteSeparator = 'auto'): CardDraft[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const selected = separator === 'auto'
    ? lines[0].includes('\t') ? 'tab' : lines[0].includes(' — ') || lines[0].includes(' - ') ? 'dash' : lines[0].includes(': ') ? 'colon' : lines[0].includes(',') ? 'comma' : 'tab'
    : separator;
  if (selected === 'tab' || selected === 'comma') {
    if (selected === 'tab' && !lines[0].includes('\t')) throw new Error('Không tìm thấy dấu tab giữa từ và nghĩa.');
    if (selected === 'comma' && !lines[0].includes(',')) throw new Error('Không tìm thấy dấu phẩy giữa từ và nghĩa.');
    return parseDelimited(text);
  }
  const delimiter = selected === 'colon' ? ':' : lines[0].includes(' — ') ? ' — ' : ' - ';
  return lines.map(line => {
    const at = line.indexOf(delimiter);
    return { term: at < 0 ? line.trim() : line.slice(0, at).trim(), definition: at < 0 ? '' : line.slice(at + delimiter.length).trim(), phonetic: '', example: '', example_translation: '', notes: '', synonyms: '', antonyms: '' };
  });
}
