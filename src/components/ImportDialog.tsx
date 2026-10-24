'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { parseDelimited, parseImport, type CardSeparator, type ImportOptions, type TermSeparator } from '@/lib/import';
import type { CardDraft } from '@/lib/types';

const emptyCard: CardDraft = { term: '', definition: '', phonetic: '', example: '', example_translation: '', notes: '', synonyms: '', antonyms: '' };
const PREVIEW_LIMIT = 50;

/** Map a spreadsheet/JSON row with English or Vietnamese headers onto a card. */
function mapRow(row: Record<string, unknown>): CardDraft {
  const map = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const get = (...names: string[]) => String(names.map(n => map[n]).find(v => v !== undefined && v !== null) ?? '').trim();
  return { term: get('term', 'word', 'từ'), definition: get('definition', 'meaning', 'nghĩa'), phonetic: get('phonetic', 'ipa', 'phiên âm'), example: get('example', 'ví dụ'), example_translation: get('example_translation'), notes: get('notes', 'ghi chú'), synonyms: get('synonyms'), antonyms: get('antonyms') };
}

/** Quizlet-style "Import your data" dialog: paste text, pick separators, see a live preview. */
export function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (rows: CardDraft[]) => void }) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<ImportOptions>({ term: 'tab', card: 'newline', customTerm: '', customCard: '' });
  const [file, setFile] = useState<{ name: string; rows: CardDraft[] } | null>(null);
  const [error, setError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const customTermRef = useRef<HTMLInputElement>(null);
  const customCardRef = useRef<HTMLInputElement>(null);
  const pasted = useMemo(() => parseImport(text, options).map(r => ({ ...emptyCard, ...r })), [text, options]);
  const rows = (file ? file.rows : pasted).filter(r => r.term || r.definition);

  useEffect(() => { textRef.current?.focus(); const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);

  async function readFile(source: File) {
    setError('');
    if (source.size > 8 * 1024 * 1024) return setError('Tệp vượt quá 8 MB. Hãy chia nhỏ tệp.');
    try {
      let result: CardDraft[];
      if (/\.xlsx?$/i.test(source.name)) {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(await source.arrayBuffer());
        result = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '' }).map(mapRow);
      } else {
        const content = await source.text();
        if (/\.json$/i.test(source.name)) { const parsed = JSON.parse(content); result = (Array.isArray(parsed) ? parsed : parsed.cards || []).map(mapRow); }
        else result = parseDelimited(content);
      }
      if (!result.length) throw new Error('Không tìm thấy thẻ nào trong tệp.');
      setFile({ name: source.name, rows: result });
    } catch (e) { setFile(null); setError(e instanceof Error && e.message ? e.message : 'Không đọc được tệp.'); }
  }

  function pickTerm(term: TermSeparator) { setOptions(o => ({ ...o, term })); if (term === 'custom') setTimeout(() => customTermRef.current?.focus()); }
  function pickCard(card: CardSeparator) { setOptions(o => ({ ...o, card })); if (card === 'custom') setTimeout(() => customCardRef.current?.focus()); }
  function onTextKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Typing a Tab between term and definition is the default Quizlet format, so let Tab insert a tab character here.
    if (e.key !== 'Tab' || e.shiftKey || options.term !== 'tab') return;
    e.preventDefault();
    const el = e.currentTarget; const { selectionStart: start, selectionEnd: end } = el;
    setText(t => t.slice(0, start) + '\t' + t.slice(end));
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 1; });
  }

  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="modal qz-import" role="dialog" aria-modal="true" aria-labelledby="qz-import-title">
      <div className="between modal-header">
        <div><h2 id="qz-import-title">Dán danh sách từ</h2><p className="muted qz-import-sub">Dán danh sách từ của bạn vào đây (từ Word, Excel, Google Docs…). Mỗi dòng là một thẻ.</p></div>
        <button className="icon-button" aria-label="Đóng" onClick={onClose}><X size={18} /></button>
      </div>
      {file ? <div className="qz-file-chip"><FileUp size={18} /><span><strong>{file.name}</strong><small>{file.rows.length} dòng được đọc từ tệp</small></span><button className="icon-button" aria-label="Bỏ tệp" onClick={() => setFile(null)}><X size={15} /></button></div>
        : <textarea ref={textRef} className="textarea qz-import-text" aria-label="Dữ liệu cần nhập" value={text} spellCheck={false} onChange={e => setText(e.target.value)} onKeyDown={onTextKey} placeholder={'Từ 1\tNghĩa 1\nTừ 2\tNghĩa 2\nTừ 3\tNghĩa 3'} />}
      {!file && <div className="qz-separators">
        <fieldset><legend>Giữa từ và nghĩa</legend>
          <label className="qz-radio"><input type="radio" name="term-sep" checked={options.term === 'tab'} onChange={() => pickTerm('tab')} /> Phím Tab</label>
          <label className="qz-radio"><input type="radio" name="term-sep" checked={options.term === 'comma'} onChange={() => pickTerm('comma')} /> Phẩy</label>
          <label className="qz-radio"><input type="radio" name="term-sep" checked={options.term === 'custom'} onChange={() => pickTerm('custom')} /><input ref={customTermRef} className="input qz-custom" aria-label="Dấu ngăn tùy chỉnh giữa từ và nghĩa" placeholder="-" value={options.customTerm} onFocus={() => setOptions(o => ({ ...o, term: 'custom' }))} onChange={e => setOptions(o => ({ ...o, term: 'custom', customTerm: e.target.value }))} /></label>
        </fieldset>
        <fieldset><legend>Giữa các thẻ</legend>
          <label className="qz-radio"><input type="radio" name="card-sep" checked={options.card === 'newline'} onChange={() => pickCard('newline')} /> Xuống dòng</label>
          <label className="qz-radio"><input type="radio" name="card-sep" checked={options.card === 'semicolon'} onChange={() => pickCard('semicolon')} /> Chấm phẩy</label>
          <label className="qz-radio"><input type="radio" name="card-sep" checked={options.card === 'custom'} onChange={() => pickCard('custom')} /><input ref={customCardRef} className="input qz-custom" aria-label="Dấu ngăn tùy chỉnh giữa các thẻ" placeholder="\n\n" value={options.customCard} onFocus={() => setOptions(o => ({ ...o, card: 'custom' }))} onChange={e => setOptions(o => ({ ...o, card: 'custom', customCard: e.target.value }))} /></label>
        </fieldset>
      </div>}
      {!file && <label className="qz-upload"><FileUp size={16} /> Hoặc chọn tệp Excel từ máy<input type="file" accept=".csv,.tsv,.txt,.json,.xlsx,.xls" onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} /></label>}
      {error && <div className="qz-alert" role="alert">{error}</div>}
      <div className="qz-preview">
        <h3>Xem trước <span>{rows.length} thẻ</span></h3>
        {rows.length ? <ol>{rows.slice(0, PREVIEW_LIMIT).map((r, i) => <li key={i} className={!r.term || !r.definition ? 'incomplete' : ''}><span className="qz-num">{i + 1}</span><span>{r.term || <em>Thiếu từ</em>}</span><span>{r.definition || <em>Thiếu nghĩa</em>}</span></li>)}</ol> : <p className="muted">Không có nội dung để xem trước.</p>}
        {rows.length > PREVIEW_LIMIT && <p className="muted">…và {rows.length - PREVIEW_LIMIT} thẻ khác.</p>}
      </div>
      <div className="qz-import-actions"><button className="btn ghost" onClick={onClose}>Hủy nhập</button><button className="btn primary" disabled={!rows.length} onClick={() => onImport(rows)}>Nhập {rows.length ? `${rows.length} thẻ` : ''}</button></div>
    </div>
  </div>;
}
