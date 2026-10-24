'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ClipboardList, RotateCcw, Trophy, Volume2, X } from 'lucide-react';
import { normalizeAnswer, shuffle, type Rating } from '@/lib/study';
import type { Card } from '@/lib/types';

type QuestionType = 'smart' | 'choice' | 'typing';
type AskWith = 'term' | 'definition';
type Prefs = { type: QuestionType; askWith: AskWith };
type Saved = { queue: string[]; pos: number; stages: Record<string, 'choice' | 'typing'>; mastered: string[]; missed: string[]; attempts: number };

const PREFS_KEY = 'vanlet-learn-prefs';
/** A missed card comes back after this many other questions instead of waiting for the end. */
const RETRY_GAP_WRONG = 3;
/** In smart mode a card answered right by choice comes back later as a typing question. */
const RETRY_GAP_PROMOTE = 6;
const AUTO_NEXT_MS = 650;

const readJSON = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null; } catch { return null; } };
const writeJSON = (key: string, value: unknown) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };
const insertAt = (list: string[], at: number, id: string) => [...list.slice(0, at), id, ...list.slice(at)];

type Props = {
  cards: Card[];
  /** Used to remember progress per set so leaving and coming back resumes the session. */
  setId: string | null;
  onRate: (card: Card, rating: Rating) => void;
  onFinish: (mastered: number, total: number) => void;
  onQuiz: (cards: Card[]) => void;
  onBack: () => void;
  onSpeak: (text: string) => void;
};

/** Quizlet-style Learn: multiple choice and/or typing, auto-advance on correct answers, missed words come back soon. */
export function LearnSession({ cards, setId, onRate, onFinish, onQuiz, onBack, onSpeak }: Props) {
  const storageKey = setId ? `vanlet-learn-${setId}` : null;
  const byId = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  const [prefs, setPrefs] = useState<Prefs>(() => ({ type: 'smart', askWith: 'term', ...(typeof window === 'undefined' ? {} : readJSON<Prefs>(PREFS_KEY)) }));
  const [session, setSession] = useState<Saved>(() => {
    const saved = storageKey && typeof window !== 'undefined' ? readJSON<Saved>(storageKey) : null;
    if (saved && saved.queue?.length && saved.pos < saved.queue.length && saved.queue.every(id => byId.has(id))) return saved;
    return { queue: shuffle(cards.map(c => c.id)), pos: 0, stages: {}, mastered: [], missed: [], attempts: 0 };
  });
  const [resumed, setResumed] = useState(() => session.pos > 0 || session.mastered.length > 0);
  const [feedback, setFeedback] = useState<{ ok: boolean; value: string } | null>(null);
  const [answer, setAnswer] = useState('');
  const finishedRef = useRef(false);
  const total = cards.length;
  const done = session.pos >= session.queue.length;
  const card = done ? undefined : byId.get(session.queue[session.pos]);
  const finalStage = prefs.type === 'choice' ? 'choice' : 'typing';
  const stage: 'choice' | 'typing' = prefs.type === 'choice' ? 'choice' : prefs.type === 'typing' ? 'typing' : (card && session.stages[card.id]) || (total < 2 ? 'typing' : 'choice');
  const prompt = card ? (prefs.askWith === 'term' ? card.term : card.definition) : '';
  const expected = card ? (prefs.askWith === 'term' ? card.definition : card.term) : '';

  useEffect(() => { writeJSON(PREFS_KEY, prefs); }, [prefs]);
  useEffect(() => { if (storageKey) writeJSON(storageKey, done ? null : session); }, [storageKey, session, done]);
  useEffect(() => { if (done && !finishedRef.current && total) { finishedRef.current = true; onFinish(session.mastered.length, total); } }, [done, total, session.mastered.length, onFinish]);

  const options = useMemo(() => {
    if (!card || stage !== 'choice') return [];
    const value = (c: Card) => prefs.askWith === 'term' ? c.definition : c.term;
    const right = value(card);
    const others = [...new Set(cards.filter(c => c.id !== card.id).map(value).filter(v => normalizeAnswer(v) !== normalizeAnswer(right)))];
    return shuffle([right, ...shuffle(others).slice(0, 3)]);
    // Re-shuffle only when the question changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, session.pos, stage, prefs.askWith]);

  const advance = useCallback((override = false) => {
    if (!card || !feedback) return;
    const ok = feedback.ok || override;
    setSession(s => {
      const id = card.id; let queue = s.queue; const stages = { ...s.stages }; let mastered = s.mastered; let missed = s.missed;
      if (ok && stage === finalStage) mastered = mastered.includes(id) ? mastered : [...mastered, id];
      else if (ok) { stages[id] = 'typing'; queue = insertAt(queue, Math.min(queue.length, s.pos + 1 + RETRY_GAP_PROMOTE), id); }
      else { missed = missed.includes(id) ? missed : [...missed, id]; queue = insertAt(queue, Math.min(queue.length, s.pos + 1 + RETRY_GAP_WRONG), id); }
      return { ...s, queue, stages, mastered, missed, pos: s.pos + 1 };
    });
    if (ok && stage === finalStage) onRate(card, session.missed.includes(card.id) ? 'hard' : 'good');
    else if (!ok) onRate(card, 'again');
    setFeedback(null); setAnswer(''); setResumed(false);
  }, [card, feedback, stage, finalStage, onRate, session.missed]);

  function submit(value: string, skipped = false) {
    if (!card || feedback) return;
    if (!skipped && stage === 'typing' && !value.trim()) return;
    const ok = !skipped && normalizeAnswer(value) === normalizeAnswer(expected);
    setFeedback({ ok, value }); setSession(s => ({ ...s, attempts: s.attempts + 1 }));
  }

  // Correct answers move on by themselves; wrong ones wait so the right answer can be read.
  useEffect(() => { if (!feedback?.ok) return; const t = setTimeout(() => advance(), AUTO_NEXT_MS); return () => clearTimeout(t); }, [feedback, advance]);

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (feedback) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); advance(); } return; }
      const n = Number(e.key); if (stage === 'choice' && n >= 1 && n <= options.length) submit(options[n - 1]);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  function restart(subset?: Card[]) {
    const source = subset?.length ? subset : cards;
    finishedRef.current = false;
    setSession({ queue: shuffle(source.map(c => c.id)), pos: 0, stages: {}, mastered: [], missed: [], attempts: 0 });
    setFeedback(null); setAnswer(''); setResumed(false);
  }

  const learnTotal = new Set(session.queue).size;
  const masteredPct = Math.round(session.mastered.length / Math.max(1, learnTotal) * 100);
  const missedCards = session.missed.map(id => byId.get(id)).filter((c): c is Card => Boolean(c));

  if (done) {
    const firstTry = learnTotal - missedCards.length;
    return <div className="learn-screen">
      <div className="panel result">
        <span className="tone-icon green big"><Trophy size={26} /></span>
        <h1>{missedCards.length === 0 ? 'Hoàn hảo!' : 'Hoàn thành!'}</h1>
        <p className="muted">Bạn đã thuộc cả {learnTotal} từ trong lượt học này.</p>
        <div className="result-score"><strong>{firstTry}/{learnTotal}</strong><span>đúng ngay lần đầu · {Math.round(firstTry / Math.max(1, learnTotal) * 100)}%</span></div>
        <div className="study-controls">
          {missedCards.length > 0 && <button className="btn primary" onClick={() => onQuiz(missedCards)}><ClipboardList /> Làm quiz {missedCards.length} từ đã sai</button>}
          {missedCards.length > 0 && <button className="btn" onClick={() => restart(missedCards)}><RotateCcw /> Học lại từ đã sai</button>}
          <button className="btn" onClick={() => restart()}><RotateCcw /> Học lại từ đầu</button>
          <button className="btn ghost" onClick={onBack}>Quay lại bộ từ</button>
        </div>
      </div>
      {missedCards.length > 0 && <div className="panel missed-list">
        <h3>Những từ bạn đã trả lời sai <span className="muted">({missedCards.length})</span></h3>
        <ul>{missedCards.map(c => <li key={c.id}><strong>{c.term}</strong><span>{c.definition}</span></li>)}</ul>
      </div>}
    </div>;
  }
  if (!card) return null;

  const showOverride = feedback && !feedback.ok && stage === 'typing' && !!feedback.value.trim();
  return <div className="learn-screen">
    <div className="learn-toolbar">
      <div className="segmented" role="radiogroup" aria-label="Kiểu câu hỏi">
        {([['smart', 'Thông minh'], ['choice', 'Trắc nghiệm'], ['typing', 'Tự gõ']] as const).map(([value, label]) =>
          <button key={value} role="radio" aria-checked={prefs.type === value} className={prefs.type === value ? 'on' : ''} disabled={!!feedback} onClick={() => setPrefs(p => ({ ...p, type: value }))}>{label}</button>)}
      </div>
      <label className="learn-ask"><span className="muted small">Hỏi bằng</span><select className="select compact" value={prefs.askWith} disabled={!!feedback} onChange={e => setPrefs(p => ({ ...p, askWith: e.target.value as AskWith }))}><option value="term">Từ</option><option value="definition">Nghĩa</option></select></label>
    </div>
    <div className="learn-progress" aria-label={`Đã thuộc ${session.mastered.length} trên ${learnTotal} từ`}>
      <div className="study-progress"><span style={{ width: `${masteredPct}%` }} /></div>
      <span className="muted small">Đã thuộc <strong>{session.mastered.length}</strong>/{learnTotal}{session.missed.length > 0 && <> · Sai {session.missed.length}</>}</span>
    </div>
    {resumed && <div className="qz-banner" role="status"><span>Đang học tiếp từ chỗ bạn dừng lần trước.</span><button className="btn ghost small" onClick={() => restart()}>Học lại từ đầu</button></div>}

    <div className={`panel learn-panel ${feedback ? (feedback.ok ? 'is-correct' : 'is-wrong') : ''}`}>
      <div className="learn-question">
        <div className="between"><span className="eyebrow">{prefs.askWith === 'term' ? 'Từ' : 'Nghĩa'}</span><span className={`stage-pill ${stage}`}>{stage === 'choice' ? 'Chọn đáp án' : 'Tự gõ đáp án'}</span></div>
        <div className="learn-word">{prompt}{prefs.askWith === 'term' && <button className="icon-button plain learn-speak" aria-label="Nghe phát âm" onClick={() => onSpeak(card.term)}><Volume2 size={18} /></button>}</div>
      </div>
      <p className="learn-prompt">{stage === 'choice' ? `Chọn ${prefs.askWith === 'term' ? 'nghĩa' : 'từ'} đúng` : `Gõ ${prefs.askWith === 'term' ? 'nghĩa' : 'từ'}`}</p>
      {stage === 'choice'
        ? <div className="learn-options">{options.map((option, i) => {
            const isRight = feedback && normalizeAnswer(option) === normalizeAnswer(expected);
            const isWrong = feedback && !isRight && option === feedback.value;
            return <button key={`${option}-${i}`} className={`answer-option ${isRight ? 'correct' : isWrong ? 'wrong' : ''}`} disabled={!!feedback} onClick={() => submit(option)}><span className="option-key">{isRight ? <Check size={14} /> : isWrong ? <X size={14} /> : i + 1}</span><span>{option}</span></button>;
          })}</div>
        : <form className="learn-input" onSubmit={e => { e.preventDefault(); if (feedback) advance(); else submit(answer); }}>
            <input key={`${card.id}-${session.pos}`} className={`input big ${feedback ? (feedback.ok ? 'correct' : 'wrong') : ''}`} autoFocus aria-label="Câu trả lời của bạn" value={answer} readOnly={!!feedback} onChange={e => setAnswer(e.target.value)} placeholder="Nhập câu trả lời" autoComplete="off" spellCheck={false} />
          </form>}
      {feedback && <div className={`learn-feedback ${feedback.ok ? 'correct' : 'wrong'}`} role="status">
        {feedback.ok ? <Check size={18} /> : <X size={18} />}
        <div><strong>{feedback.ok ? 'Chính xác!' : feedback.value ? 'Chưa đúng – từ này sẽ quay lại sau vài câu.' : 'Không sao – từ này sẽ quay lại sau vài câu.'}</strong>{!feedback.ok && <span>Đáp án đúng: {expected}</span>}</div>
      </div>}
      <div className="learn-actions">
        <span className="muted small">{feedback ? (feedback.ok ? 'Đang chuyển sang từ tiếp theo…' : 'Nhấn Enter để tiếp tục') : stage === 'typing' ? 'Nhấn Enter để kiểm tra' : `Nhấn phím 1–${options.length} để chọn`}</span>
        {!feedback && <button className="btn ghost" onClick={() => submit('', true)}>Không biết?</button>}
        {!feedback && stage === 'typing' && <button className="btn primary" disabled={!answer.trim()} onClick={() => submit(answer)}>Trả lời</button>}
        {showOverride && <button className="btn ghost" onClick={() => advance(true)}>Tôi đã trả lời đúng</button>}
        {feedback && !feedback.ok && <button className="btn primary" autoFocus onClick={() => advance()}>Tiếp tục <ArrowRight /></button>}
      </div>
    </div>
    <p className="muted small learn-meta">{session.attempts} lượt trả lời · Từ sai sẽ được hỏi lại sau {RETRY_GAP_WRONG} câu</p>
  </div>;
}
