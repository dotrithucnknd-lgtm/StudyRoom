'use client';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronLeft, GripVertical, Plus, Settings2, Trash2 } from 'lucide-react';
import { ImportDialog } from '@/components/ImportDialog';
import type { CardDraft, Folder, SetDraft } from '@/lib/types';
import { CARD_LIMITS, FIELD_LABELS, type LimitedField } from '@/lib/limits';

export type EditorCard = CardDraft & { key: string; id?: string };
export const newEditorCard = (): EditorCard => ({ key: crypto.randomUUID(), term: '', definition: '', phonetic: '', example: '', example_translation: '', notes: '', synonyms: '', antonyms: '' });
const DRAFT_KEY = 'vanlet-set-draft';
const MIN_CARDS = 2;
const isBlank = (c: CardDraft) => !c.term.trim() && !c.definition.trim();
const extraFields = [
  { field: 'phonetic', label: 'Phiên âm', placeholder: 'Cách đọc, ví dụ /ˈhæp.i/' },
  { field: 'example', label: 'Ví dụ', placeholder: 'Câu ví dụ có dùng từ' },
  { field: 'example_translation', label: 'Dịch ví dụ', placeholder: 'Nghĩa của câu ví dụ' },
  { field: 'notes', label: 'Ghi chú', placeholder: 'Mẹo ghi nhớ, ngữ cảnh…' },
  { field: 'synonyms', label: 'Đồng nghĩa', placeholder: 'Cách nhau bằng dấu phẩy' },
  { field: 'antonyms', label: 'Trái nghĩa', placeholder: 'Cách nhau bằng dấu phẩy' },
] as const;

type Props = {
  mode: 'create' | 'edit';
  initialSet: SetDraft;
  initialCards: EditorCard[];
  canEditMeta: boolean;
  folders: Folder[];
  focusKey: string | null;
  openImport: boolean;
  saving: boolean;
  savingLabel?: string;
  onCancel: () => void;
  onSave: (set: SetDraft, cards: EditorCard[]) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  notify: (message: string) => void;
};

let autosize: boolean | null = null;
/** Measuring every textarea forces a layout per field, which froze the page for ~20s with 700+ cards. */
const nativeAutosize = () => autosize ??= typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

type RowActions = {
  update: (key: string, patch: Partial<CardDraft>) => void; toggle: (key: string) => void; insertAt: (index: number) => void; remove: (key: string) => void;
  move: (from: number, to: number) => void; tabToNext: (e: React.KeyboardEvent, index: number) => void; register: (id: string, el: HTMLTextAreaElement | null) => void;
  arm: (key: string | null) => void; dragStart: (e: React.DragEvent, index: number) => void; dragOver: (e: React.DragEvent, index: number) => void; drop: (e: React.DragEvent, index: number) => void; dragEnd: () => void;
};
type RowProps = { card: EditorCard; index: number; isLast: boolean; error?: string; errorField?: string; open: boolean; canDelete: boolean; dropTarget: boolean; dragging: boolean; draggable: boolean; actions: RowActions };

/** One card in the editor. Memoized so typing in one card doesn't re-render hundreds of others. */
const CardRow = memo(function CardRow({ card: c, index: i, isLast, error, errorField, open, canDelete, dropTarget, dragging, draggable, actions }: RowProps) {
  const extrasFilled = extraFields.filter(({ field }) => c[field].trim()).length;
  return <li className={`qz-card ${dropTarget ? 'drop-target' : ''} ${dragging ? 'dragging' : ''} ${error ? 'has-error' : ''}`}
    draggable={draggable} onDragStart={e => actions.dragStart(e, i)} onDragOver={e => actions.dragOver(e, i)} onDrop={e => actions.drop(e, i)} onDragEnd={actions.dragEnd}>
    <div className="qz-card-head">
      <span className="qz-num">{i + 1}</span>
      <div className="qz-card-tools">
        <button className="qz-handle" aria-label={`Di chuyển thẻ ${i + 1} (kéo, hoặc Alt + mũi tên lên/xuống)`} title="Kéo để sắp xếp" onPointerDown={() => actions.arm(c.key)} onPointerUp={() => actions.arm(null)} onKeyDown={e => { if (!e.altKey) return; if (e.key === 'ArrowUp') { e.preventDefault(); actions.move(i, i - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); actions.move(i, i + 1); } }}><GripVertical size={18} /></button>
        <button className="icon-button" aria-label={`Xóa thẻ ${i + 1}`} title={canDelete ? 'Xóa thẻ' : 'Bộ từ cần ít nhất hai thẻ'} disabled={!canDelete} onClick={() => actions.remove(c.key)}><Trash2 size={16} /></button>
      </div>
    </div>
    <div className="qz-card-body">
      <LineField label="Từ" placeholder="Nhập từ" value={c.term} invalid={errorField === 'term'} register={el => actions.register(`${c.key}:term`, el)} onChange={term => actions.update(c.key, { term })} />
      <LineField label="Nghĩa" placeholder="Nhập nghĩa" value={c.definition} invalid={errorField === 'definition'} register={el => actions.register(`${c.key}:definition`, el)} onChange={definition => actions.update(c.key, { definition })}
        onKeyDown={open ? undefined : e => actions.tabToNext(e, i)} />
    </div>
    {error && <p className="qz-error" role="alert">{error}</p>}
    <button className="qz-more" aria-expanded={open} onClick={() => actions.toggle(c.key)}>{open ? 'Ẩn chi tiết' : extrasFilled ? `+ Chi tiết (${extrasFilled})` : '+ Phiên âm, ví dụ, ghi chú'}</button>
    {open && <div className="qz-extra">{extraFields.map(({ field, label, placeholder }, k) => <LineField key={field} label={label} placeholder={placeholder} value={c[field]} invalid={errorField === field} onChange={value => actions.update(c.key, { [field]: value })}
      onKeyDown={k === extraFields.length - 1 ? e => actions.tabToNext(e, i) : undefined} />)}</div>}
    {!isLast && <button className="qz-insert" aria-label={`Chèn thẻ mới sau thẻ ${i + 1}`} title="Chèn thẻ" onClick={() => actions.insertAt(i + 1)}><Plus size={16} /></button>}
  </li>;
});

/** Underlined, auto-growing field with its label underneath, like Quizlet's card editor. */
function LineField({ label, value, onChange, placeholder, invalid, big, disabled, register, onKeyDown }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; invalid?: boolean; big?: boolean; disabled?: boolean; register?: (el: HTMLTextAreaElement | null) => void; onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => { const el = ref.current; if (!el || nativeAutosize()) return; el.style.height = '0px'; el.style.height = `${el.scrollHeight}px`; }, [value]);
  return <label className={`qz-field ${big ? 'big' : ''} ${invalid ? 'invalid' : ''}`}>
    <textarea ref={el => { ref.current = el; register?.(el); }} rows={1} value={value} disabled={disabled} placeholder={placeholder} aria-invalid={invalid || undefined} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} />
    <span>{label}</span>
  </label>;
}

export function SetEditor({ mode, initialSet, initialCards, canEditMeta, folders, focusKey, openImport, saving, savingLabel, onCancel, onSave, onDirtyChange, notify }: Props) {
  const [set, setSet] = useState<SetDraft>(initialSet);
  const [cards, setCards] = useState<EditorCard[]>(() => initialCards.length ? initialCards : Array.from({ length: 3 }, newEditorCard));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showOptions, setShowOptions] = useState(false);
  const [importing, setImporting] = useState(openImport);
  const [errors, setErrors] = useState<{ title?: string; general?: string; cards: Record<string, { message: string; field: string }> }>({ cards: {} });
  const [dirty, setDirtyState] = useState(false);
  const [restored, setRestored] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingFocus = useRef<string | null>(focusKey ? `${focusKey}:term` : mode === 'create' ? 'title' : null);
  const filledCount = cards.filter(c => !isBlank(c)).length;

  function markDirty() { if (!dirty) { setDirtyState(true); onDirtyChange(true); } }

  // Focus/scroll requests are queued and resolved after the next render, once the target field exists.
  useEffect(() => {
    const target = pendingFocus.current; if (!target) return;
    const el = target === 'title' ? titleRef.current : fields.current.get(target);
    if (!el) return;
    pendingFocus.current = null; el.focus({ preventScroll: true }); if (target !== 'title') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  useEffect(() => {
    if (mode !== 'create') return;
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') as { set: SetDraft; cards: CardDraft[] } | null;
      if (saved && (saved.set?.title?.trim() || saved.cards?.some(c => !isBlank(c)))) {
        setSet({ ...initialSet, ...saved.set });
        setCards(saved.cards.map(c => ({ ...newEditorCard(), ...c })));
        setRestored(true);
      }
    } catch { /* storage unavailable: start fresh */ }
    // Only on first mount: restoring must not overwrite later edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quizlet autosaves new sets as drafts; mirror that in browser storage.
  useEffect(() => {
    if (mode !== 'create' || !dirty) return;
    const timer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ set, cards: cards.map(({ key: _key, id: _id, ...c }) => c) })); } catch { /* ignore */ } }, 400);
    return () => clearTimeout(timer);
  }, [set, cards, dirty, mode]);

  useEffect(() => {
    if (!dirty || mode === 'create') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  function updateSet(patch: Partial<SetDraft>) { setSet(s => ({ ...s, ...patch })); markDirty(); if (patch.title !== undefined && errors.title) setErrors(e => ({ ...e, title: undefined })); }
  function updateCard(key: string, patch: Partial<CardDraft>) {
    setCards(cs => cs.map(c => c.key === key ? { ...c, ...patch } : c)); markDirty();
    if (errors.cards[key]) setErrors(e => { const next = { ...e.cards }; delete next[key]; return { ...e, cards: next }; });
  }
  /** Quizlet flow: Tab out of a card's last field jumps straight to the next card's term, creating one at the end. */
  function tabToNext(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    if (index === cards.length - 1) insertAt(cards.length);
    else fields.current.get(`${cards[index + 1].key}:term`)?.focus();
  }
  function insertAt(index: number) { const card = newEditorCard(); setCards(cs => [...cs.slice(0, index), card, ...cs.slice(index)]); pendingFocus.current = `${card.key}:term`; markDirty(); }
  function remove(key: string) { setCards(cs => cs.filter(c => c.key !== key)); markDirty(); }
  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= cards.length) return;
    setCards(cs => { const next = [...cs]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }); markDirty();
  }
  function swapSides() {
    setCards(cs => cs.map(c => ({ ...c, term: c.definition, definition: c.term })));
    if (canEditMeta) setSet(s => ({ ...s, source_language: s.target_language, target_language: s.source_language }));
    markDirty(); notify('Đã đổi từ và nghĩa.');
  }
  function importRows(rows: CardDraft[]) {
    setCards(cs => [...cs.filter(c => !isBlank(c)), ...rows.map(r => ({ ...newEditorCard(), ...r }))]);
    setImporting(false); markDirty(); notify(`Đã nhập ${rows.length} thẻ.`);
  }
  function discardDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setSet(initialSet); setCards(Array.from({ length: 3 }, newEditorCard)); setRestored(false); setErrors({ cards: {} }); setDirtyState(false); onDirtyChange(false); pendingFocus.current = 'title';
  }
  function cancel() { if (dirty && mode === 'edit' && !confirm('Bỏ các thay đổi chưa lưu?')) return; onCancel(); }

  async function save() {
    if (saving) return;
    const title = set.title.trim();
    const filled = cards.filter(c => !isBlank(c));
    const cleaned = filled.map(c => ({ ...c, ...Object.fromEntries((Object.keys(CARD_LIMITS) as LimitedField[]).map(f => [f, c[f].trim()])) }) as EditorCard);
    const cardErrors: Record<string, { message: string; field: string }> = {};
    for (const c of cleaned) {
      if (!c.term) cardErrors[c.key] = { message: 'Hãy nhập từ.', field: 'term' };
      else if (!c.definition) cardErrors[c.key] = { message: 'Hãy nhập nghĩa.', field: 'definition' };
      else { const long = (Object.keys(CARD_LIMITS) as LimitedField[]).find(f => c[f].length > CARD_LIMITS[f]); if (long) cardErrors[c.key] = { message: `${FIELD_LABELS[long]} quá dài (${c[long].length}/${CARD_LIMITS[long]} ký tự). Hãy rút gọn hoặc tách thành nhiều thẻ.`, field: long }; }
    }
    const badCount = Object.keys(cardErrors).length;
    const minimum = mode === 'create' ? MIN_CARDS : 1;
    const general = badCount ? `Có ${badCount} thẻ cần sửa trước khi lưu. Đã chuyển đến thẻ đầu tiên bị lỗi.` : filled.length < minimum ? (mode === 'create' ? 'Bạn cần ít nhất hai thẻ để tạo bộ từ.' : 'Bộ từ cần ít nhất một thẻ.') : undefined;
    setErrors({ title: title ? undefined : 'Hãy nhập tiêu đề để tạo bộ từ.', general, cards: cardErrors });
    if (!title) { titleRef.current?.focus(); titleRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const firstBad = cleaned.find(c => cardErrors[c.key]);
    if (firstBad) {
      const field = cardErrors[firstBad.key].field;
      if (field !== 'term' && field !== 'definition') setExpanded(x => ({ ...x, [firstBad.key]: true }));
      pendingFocus.current = `${firstBad.key}:${field === 'term' ? 'term' : 'definition'}`; setCards(cs => [...cs]); return;
    }
    if (general) return;
    const ok = await onSave({ ...set, title }, cleaned);
    if (ok && mode === 'create') { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
  }

  const impl = useRef<RowActions>(null!);
  impl.current = {
    update: updateCard, insertAt, remove, move, tabToNext,
    toggle: key => setExpanded(x => ({ ...x, [key]: !x[key] })),
    register: (id, el) => { if (el) fields.current.set(id, el); else fields.current.delete(id); },
    arm: setArmed,
    dragStart: (e, i) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); setDrag({ from: i, over: i }); },
    dragOver: (e, i) => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); },
    drop: (e, i) => { e.preventDefault(); if (drag) move(drag.from, i); setDrag(null); setArmed(null); },
    dragEnd: () => { setDrag(null); setArmed(null); },
  };
  const actions = useMemo<RowActions>(() => ({
    update: (k, p) => impl.current.update(k, p), toggle: k => impl.current.toggle(k), insertAt: i => impl.current.insertAt(i), remove: k => impl.current.remove(k),
    move: (a, b) => impl.current.move(a, b), tabToNext: (e, i) => impl.current.tabToNext(e, i), register: (id, el) => impl.current.register(id, el), arm: k => impl.current.arm(k),
    dragStart: (e, i) => impl.current.dragStart(e, i), dragOver: (e, i) => impl.current.dragOver(e, i), drop: (e, i) => impl.current.drop(e, i), dragEnd: () => impl.current.dragEnd(),
  }), []);

  const action = mode === 'create' ? 'Tạo' : 'Xong';
  const busyLabel = savingLabel || 'Đang lưu…';
  return <div className="qz-editor">
    <div className="qz-topbar">
      <button className="btn ghost small" onClick={cancel}><ChevronLeft /> {mode === 'create' ? 'Quay lại' : 'Bộ từ'}</button>
      <div className="qz-topbar-title"><strong>{mode === 'create' ? 'Tạo bộ từ mới' : 'Chỉnh sửa bộ từ'}</strong><span>{mode === 'create' ? dirty ? 'Đã tự lưu nháp' : 'Bản nháp được lưu tự động' : dirty ? 'Có thay đổi chưa lưu' : 'Chưa có thay đổi'}</span></div>
      <button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? busyLabel : action}</button>
    </div>

    {restored && <div className="qz-banner" role="status"><span>Đã khôi phục bản nháp bạn đang soạn dở.</span><button className="btn ghost small" onClick={discardDraft}>Bỏ bản nháp</button></div>}

    <section className="qz-meta">
      <LineField big label="Tiêu đề" placeholder="Nhập tiêu đề, ví dụ “Sinh học – Chương 22: Tiến hóa”" value={set.title} disabled={!canEditMeta} invalid={!!errors.title} register={el => { titleRef.current = el; }} onChange={title => updateSet({ title })} />
      {errors.title && <p className="qz-error" role="alert">{errors.title}</p>}
      <LineField label="Mô tả" placeholder="Thêm mô tả…" value={set.description} disabled={!canEditMeta} onChange={description => updateSet({ description })} />
      {canEditMeta && <button className="qz-options-toggle" aria-expanded={showOptions} onClick={() => setShowOptions(v => !v)}><Settings2 size={16} /> Ngôn ngữ, quyền xem và thư mục <ChevronDown size={16} className={showOptions ? 'rot' : ''} /></button>}
      {canEditMeta && showOptions && <div className="qz-options">
        <label className="field"><span>Ngôn ngữ của từ</span><input className="input" value={set.source_language} onChange={e => updateSet({ source_language: e.target.value })} /></label>
        <label className="field"><span>Ngôn ngữ của nghĩa</span><input className="input" value={set.target_language} onChange={e => updateSet({ target_language: e.target.value })} /></label>
        <label className="field"><span>Ai có thể xem</span><select className="select" value={set.visibility} onChange={e => updateSet({ visibility: e.target.value as SetDraft['visibility'] })}><option value="private">Chỉ mình tôi</option><option value="public">Mọi người</option></select></label>
        <label className="field"><span>Thư mục</span><select className="select" value={set.folder_id || ''} onChange={e => updateSet({ folder_id: e.target.value || null })}><option value="">Không thuộc thư mục</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label className="field"><span>Màu bìa</span><select className="select" value={set.cover_color} onChange={e => updateSet({ cover_color: e.target.value })}><option value="violet">Tím</option><option value="peach">Cam đào</option><option value="mint">Xanh bạc hà</option><option value="blue">Xanh trời</option><option value="pink">Hồng</option></select></label>
        <label className="field"><span>Nhãn (tuỳ chọn)</span><input className="input" value={set.tags.join(', ')} placeholder="Giao tiếp, B1" onChange={e => updateSet({ tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} /></label>
      </div>}
    </section>

    <div className="qz-toolbar">
      <button className="btn" onClick={() => setImporting(true)}><Plus /> Nhập</button>
      <button className="btn ghost" onClick={swapSides} aria-label="Đổi từ và nghĩa" title="Đổi từ và nghĩa"><ArrowLeftRight /><span className="hide-sm">Đổi từ và nghĩa</span></button>
      <span className="qz-count">{filledCount} thẻ</span>
    </div>
    {errors.general && <div className="qz-alert" role="alert">{errors.general}</div>}

    <ol className="qz-cards">
      {cards.map((c, i) => <CardRow key={c.key} card={c} index={i} isLast={i === cards.length - 1} error={errors.cards[c.key]?.message} errorField={errors.cards[c.key]?.field} open={!!expanded[c.key]} canDelete={cards.length > MIN_CARDS}
        dropTarget={drag?.over === i && drag.from !== i} dragging={drag?.from === i} draggable={armed === c.key} actions={actions} />)}
    </ol>

    <button className="qz-add" onClick={() => insertAt(cards.length)}><span className="qz-num">{cards.length + 1}</span><span className="qz-add-label"><Plus size={18} /> Thêm thẻ</span></button>
    <p className="qz-hint">Mẹo: <kbd>Tab</kbd> để sang ô tiếp theo – ở thẻ cuối sẽ tự thêm thẻ mới · <kbd>Ctrl</kbd> + <kbd>S</kbd> để lưu</p>
    <div className="qz-footer"><button className="btn primary big" disabled={saving} onClick={() => void save()}>{saving ? busyLabel : action}</button></div>

    {importing && <ImportDialog onClose={() => setImporting(false)} onImport={importRows} />}
  </div>;
}
