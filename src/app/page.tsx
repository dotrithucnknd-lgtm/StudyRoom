'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from 'recharts';
import { Button } from '@/components/ui/button';
import { SetEditor, newEditorCard, type EditorCard } from '@/components/SetEditor';
import { supabase, configured, googleEnabled } from '@/lib/supabase';
import { demoData } from '@/lib/demo';
import { normalizeAnswer, scheduleReview, shuffle, type Rating } from '@/lib/study';
import type { AppData, Card, CardDraft, SetDraft, SetRecord, Session, Progress, Folder } from '@/lib/types';
import { ArrowLeftRight, ArrowRight, BookOpen, Brain, ChartNoAxesColumn, Check, ChevronLeft, ChevronRight, Clock3, Copy, Download, Eye, EyeOff, FileUp, Flame, FolderOpen, Gamepad2, Globe2, GraduationCap, Heart, House, Layers3, LibraryBig, LogOut, Maximize2, Moon, Pencil, Play, Plus, RotateCcw, Save, Search, Settings2, Shuffle, Star, Sun, Target, Trash2, Trophy, Users, Volume2, X } from 'lucide-react';

type View = 'dashboard' | 'library' | 'shared' | 'discover' | 'set' | 'flashcards' | 'learn' | 'match' | 'test' | 'review' | 'stats' | 'settings' | 'editor';
type ShareInvite = { token: string; email: string; role: 'editor' | 'viewer'; accepted_user_id: string | null; accepted_at: string | null; expires_at: string; created_at: string };
type EditorState = { mode: 'create' | 'edit'; setId: string | null; set: SetDraft; cards: EditorCard[]; original: Card[]; focusKey: string | null; openImport: boolean; returnTo: View };
const emptySet: SetDraft = { title: '', description: '', source_language: 'English', target_language: 'Tiếng Việt', visibility: 'private', tags: [], cover_color: 'violet', folder_id: null };
const cardFields = ['term', 'definition', 'phonetic', 'example', 'example_translation', 'notes', 'synonyms', 'antonyms'] as const;
const pickCard = (c: CardDraft): CardDraft => Object.fromEntries(cardFields.map(f => [f, c[f] ?? ''])) as CardDraft;
const toSetDraft = (s: SetRecord): SetDraft => ({ title: s.title, description: s.description || '', source_language: s.source_language, target_language: s.target_language, visibility: s.visibility, tags: s.tags || [], cover_color: s.cover_color || 'violet', folder_id: s.folder_id });
/** Run async jobs with bounded concurrency so large edits don't flood the API. */
async function runLimited(jobs: (() => Promise<unknown>)[], limit = 6) { let next = 0; await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => { while (next < jobs.length) await jobs[next++](); })); }
type Tone = 'violet' | 'green' | 'amber' | 'blue' | 'pink';
const modes: { id: View; name: string; desc: string; icon: typeof Layers3; tone: Tone }[] = [
  { id: 'flashcards', name: 'Thẻ ghi nhớ', desc: 'Lật thẻ để ghi nhớ', icon: Layers3, tone: 'violet' },
  { id: 'learn', name: 'Học', desc: 'Chọn, gõ và học lại từ sai', icon: Brain, tone: 'green' },
  { id: 'test', name: 'Kiểm tra', desc: 'Thử sức kiến thức', icon: GraduationCap, tone: 'blue' },
  { id: 'match', name: 'Ghép thẻ', desc: 'Ghép cặp thật nhanh', icon: Gamepad2, tone: 'amber' },
  { id: 'review', name: 'Ôn tập', desc: 'Ôn từ sắp quên', icon: RotateCcw, tone: 'pink' },
];
const studyViews: View[] = ['flashcards', 'learn', 'match', 'test', 'review'];
const nav = [ { id: 'dashboard' as View, name: 'Trang chủ', icon: House }, { id: 'library' as View, name: 'Thư viện', icon: LibraryBig }, { id: 'shared' as View, name: 'Được chia sẻ', icon: Users }, { id: 'review' as View, name: 'Ôn tập hôm nay', icon: RotateCcw }, { id: 'stats' as View, name: 'Thống kê', icon: ChartNoAxesColumn } ];
const headerNav = [nav[0], nav[1], { ...nav[3], name: 'Ôn tập' }, { id: 'discover' as View, name: 'Khám phá', icon: Globe2 }, nav[2], nav[4]];
function formatDate(value: string) { return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(new Date(value)); }
function pronounce(text: string, language = 'English') { if (!('speechSynthesis' in window)) return false; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = language.includes('日本') || language.toLowerCase().includes('japan') ? 'ja-JP' : language.toLowerCase().includes('chinese') ? 'zh-CN' : 'en-US'; u.rate = .88; speechSynthesis.speak(u); return true; }
function download(name: string, content: string, mime: string) { const blob = new Blob(['\uFEFF', content], { type: mime }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function csvEscape(v: string, delimiter: string) { return `"${String(v).replaceAll('"', '""')}"`; }
function useToast() { const [message, setMessage] = useState(''); useEffect(() => { if (!message) return; const t = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(t); }, [message]); return { message, toast: setMessage }; }

export default function Page() {
  const [userId, setUserId] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<AppData>({ sets: [], cards: [], sessions: [], profile: null });
  const [overview, setOverview] = useState({ cards: 0, mastered: 0, due: 0 });
  const [setsTotal, setSetsTotal] = useState(0);
  const [setsPage, setSetsPage] = useState(0);
  const [discoveredSets, setDiscoveredSets] = useState<SetRecord[]>([]);
  const [discoveredTotal, setDiscoveredTotal] = useState(0);
  const [discoveredPage, setDiscoveredPage] = useState(0);
  const [sharedSets, setSharedSets] = useState<SetRecord[]>([]);
  const [sharedTotal, setSharedTotal] = useState(0);
  const [sharedPage, setSharedPage] = useState(0);
  const [view, setView] = useState<View>('dashboard');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'folder' | 'share' | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const editorDirty = useRef(false);
  const [folderName, setFolderName] = useState('');
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'editor' | 'viewer'>('viewer');
  const [shareInvites, setShareInvites] = useState<ShareInvite[]>([]);
  const [shareLink, setShareLink] = useState('');
  const [cardPage, setCardPage] = useState(0);
  const [cardTotal, setCardTotal] = useState(0);
  const [deck, setDeck] = useState<Card[]>([]);
  const [studySource, setStudySource] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unmastered' | 'difficult' | 'favorite'>('all');
  const [showHints, setShowHints] = useState(true);
  const [studyStart, setStudyStart] = useState(Date.now());
  const [correct, setCorrect] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [learnStages, setLearnStages] = useState<Record<string, 'choice' | 'typing'>>({});
  const [learnChoice, setLearnChoice] = useState('');
  const [learnMastered, setLearnMastered] = useState<string[]>([]);
  const [learnAttempts, setLearnAttempts] = useState(0);
  const [learnTotal, setLearnTotal] = useState(0);
  const [matchSelection, setMatchSelection] = useState<{ type: 'term' | 'definition'; id: string } | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrongMatch, setWrongMatch] = useState(false);
  const [matchTerms, setMatchTerms] = useState<Card[]>([]);
  const [matchDefinitions, setMatchDefinitions] = useState<Card[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [testAnswers, setTestAnswers] = useState<Record<string, string>>({});
  const [testDone, setTestDone] = useState(false);
  const [testStarted, setTestStarted] = useState(false);
  const [testType, setTestType] = useState<'typing' | 'multiple'>('typing');
  const [testNumber, setTestNumber] = useState(10);
  const [testChoices, setTestChoices] = useState<Record<string, string[]>>({});
  const [profileName, setProfileName] = useState('');
  const [dailyGoal, setDailyGoal] = useState(20);
  const [learningLanguage, setLearningLanguage] = useState('English');
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'reset' | 'update'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const { message, toast } = useToast();
  const activeSet = data.sets.find(s => s.id === selectedId) || discoveredSets.find(s => s.id === selectedId) || sharedSets.find(s => s.id === selectedId) || null;
  const ownsActiveSet = Boolean(activeSet && (demo || activeSet.owner_id === userId));
  const canEditActiveCards = ownsActiveSet || activeSet?.access_role === 'editor';
  const activeCards = data.cards.filter(c => c.set_id === selectedId);
  const allCards = data.cards;
  const learnOptions = useMemo(() => {
    const current = deck[index];
    if (!current || view !== 'learn') return [];
    const value = (card: Card) => reverse ? card.term : card.definition;
    const others = [...new Set(studySource.filter(c => c.id !== current.id).map(value).filter(v => normalizeAnswer(v) !== normalizeAnswer(value(current))))];
    return shuffle([value(current), ...shuffle(others).slice(0, 3)]);
  }, [deck[index]?.id, index, reverse, studySource, view]);
  const due = allCards.filter(c => c.progress && new Date(c.progress.due_at) <= new Date() && c.progress.state !== 'mastered');
  const dueCount = demo ? due.length : overview.due;
  const mastered = demo ? allCards.filter(c => c.mastered || c.progress?.state === 'mastered').length : overview.mastered;
  const totalCards = demo ? allCards.length : overview.cards;
  const today = new Date().toDateString();
  const todaySessions = data.sessions.filter(s => new Date(s.created_at).toDateString() === today);
  const todayMinutes = Math.round(todaySessions.reduce((a, s) => a + s.duration_seconds, 0) / 60);
  const todayReviewed = todaySessions.reduce((a, s) => a + s.total, 0);
  const goal = data.profile?.daily_goal || 20;

  useEffect(() => {
    setDark((localStorage.getItem('vanlet-theme') || localStorage.getItem('lexora-theme')) === 'dark');
    if (new URLSearchParams(location.search).get('demo') === '1') setDemo(true);
    const client = supabase();
    if (!client) { setAuthReady(true); return; }
    if (location.search.includes('code=')) client.auth.exchangeCodeForSession(new URLSearchParams(location.search).get('code') || '').then(() => history.replaceState({}, '', '/'));
    client.auth.getUser().then(({ data: result }) => { setUserId(result.user?.id || null); setAuthReady(true); });
    const { data: listener } = client.auth.onAuthStateChange((event, session) => { setUserId(session?.user?.id || null); if (session?.user) setDemo(false); if (event === 'PASSWORD_RECOVERY') setAuthMode('update'); });
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('vanlet-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { if (view !== 'match' || matched.length === matchTerms.length) return; const timer = setInterval(() => setElapsed(Math.floor((Date.now() - studyStart) / 1000)), 1000); return () => clearInterval(timer); }, [view, studyStart, matched.length, matchTerms.length]);
  useEffect(() => { if (!demo) return; const saved = localStorage.getItem('vanlet-demo') || localStorage.getItem('lexora-demo'); try { setData(saved ? JSON.parse(saved) : structuredClone(demoData)); } catch { setData(structuredClone(demoData)); } }, [demo]);
  useEffect(() => { if (demo && data.profile) localStorage.setItem('vanlet-demo', JSON.stringify(data)); }, [data, demo]);

  const api = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const token = (await supabase()?.auth.getSession())?.data.session?.access_token;
    if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    const response = await fetch(`/api/${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Không thể tải dữ liệu.'); return result;
  }, []);
  const loadLive = useCallback(async () => {
    setLoading(true);
    try {
      const [setsResult, activity, folders] = await Promise.all([api('sets'), api('activity'), api('folders')]);
      setData({ sets: setsResult.sets, cards: [], sessions: activity.sessions || [], profile: activity.profile, folders });
      setOverview(activity.overview || { cards: 0, mastered: 0, due: 0 });
      setSetsTotal(setsResult.total || 0); setSetsPage(0);
      if (activity.profile) { setProfileName(activity.profile.display_name); setDailyGoal(activity.profile.daily_goal); setLearningLanguage(activity.profile.learning_language); }
    } catch (e) { toast((e as Error).message); } finally { setLoading(false); }
  }, [api, toast]);
  useEffect(() => { if (userId && !demo) loadLive(); }, [userId, demo, loadLive]);
  const loadCards = useCallback(async (setId: string, page = 0) => {
    if (demo) return;
    setLoading(true);
    try { const result = await api(`cards?set=${setId}&page=${page}`); setData(d => ({ ...d, cards: [...d.cards.filter(c => c.set_id !== setId), ...result.cards] })); setCardTotal(result.total || 0); setCardPage(page); }
    catch (e) { toast((e as Error).message); } finally { setLoading(false); }
  }, [api, demo, toast]);
  async function loadMoreSets() { try { const page = setsPage + 1; const result = await api(`sets?page=${page}`); setData(d => ({ ...d, sets: [...d.sets, ...result.sets] })); setSetsPage(page); } catch (e) { toast((e as Error).message); } }
  async function loadShared(page = 0) { if (demo) { setSharedSets([]); setSharedTotal(0); return; } try { const result = await api(`sets?scope=shared&page=${page}`); setSharedSets(old => page ? [...old, ...result.sets] : result.sets); setSharedTotal(result.total || 0); setSharedPage(page); } catch (e) { toast((e as Error).message); } }
  useEffect(() => { if (view === 'shared') loadShared(0); }, [view, demo]);
  async function loadDiscover(page = 0, query = '') { if (demo) { const rows = data.sets.filter(s => s.visibility === 'public' && s.title.toLowerCase().includes(query.toLowerCase())); setDiscoveredSets(rows); setDiscoveredTotal(rows.length); return; } try { const result = await api(`sets?scope=public&page=${page}&q=${encodeURIComponent(query)}`); setDiscoveredSets(old => page ? [...old, ...result.sets] : result.sets); setDiscoveredTotal(result.total || 0); setDiscoveredPage(page); } catch (e) { toast((e as Error).message); } }
  useEffect(() => { if (view !== 'discover') return; const timer = setTimeout(() => loadDiscover(0, search), 250); return () => clearTimeout(timer); }, [view, search, demo, data.sets]);
  useEffect(() => { if (!userId || demo) return; const id = new URLSearchParams(location.search).get('set'); if (!id) return; api(`sets?id=${encodeURIComponent(id)}`).then(result => { const set = result.sets?.[0]; if (!set) throw new Error('Bộ từ không tồn tại hoặc bạn không có quyền xem.'); setDiscoveredSets(old => old.some(s => s.id === set.id) ? old : [set, ...old]); setSelectedId(set.id); setView('set'); loadCards(set.id); history.replaceState({}, '', '/'); }).catch(e => toast((e as Error).message)); }, [userId, demo]);
  useEffect(() => { if (!userId || demo) return; const token = new URLSearchParams(location.search).get('invite'); if (!token) return; api('shares', 'PATCH', { token }).then(async result => { const sets = await api(`sets?id=${result.set_id}`); const set = sets.sets?.[0]; if (!set) throw new Error('Không thể mở bộ từ vừa được chia sẻ.'); setSharedSets(old => old.some(s => s.id === set.id) ? old : [set, ...old]); setSelectedId(set.id); setView('set'); loadCards(set.id); history.replaceState({}, '', '/'); toast('Đã nhận lời mời chia sẻ.'); }).catch(e => toast((e as Error).message)); }, [userId, demo]);
  useEffect(() => { if (demo && data.profile) { setProfileName(data.profile.display_name); setDailyGoal(data.profile.daily_goal); setLearningLanguage(data.profile.learning_language); } }, [demo, data.profile]);
  /** Leaving the editor with unsaved edits to an existing set needs confirmation; new-set drafts are autosaved. */
  function canLeaveEditor() { if (view !== 'editor' || !editorDirty.current || editor?.mode === 'create') return true; if (!confirm('Bỏ các thay đổi chưa lưu?')) return false; editorDirty.current = false; return true; }
  function go(next: View) { if (!canLeaveEditor()) return false; setView(next); return true; }
  function openSet(id: string) { if (!canLeaveEditor()) return; setSelectedId(id); setView('set'); setSearch(''); setCardPage(0); if (!demo) loadCards(id); }
  function navTo(next: View) { if (!go(next)) return; if (next === 'review') beginMode('review', true); }
  function updateData(mutator: (old: AppData) => AppData) { setData(mutator); }
  /** Open the Quizlet-style editor: without a set it creates one; `focus` is a card id or 'new' to append a blank card. */
  async function openEditor(set?: SetRecord, options: { focus?: string; importing?: boolean } = {}) {
    if (!canLeaveEditor()) return;
    editorDirty.current = false;
    if (!set) { setEditor({ mode: 'create', setId: null, set: { ...emptySet, folder_id: folderFilter === 'all' ? null : folderFilter }, cards: [], original: [], focusKey: null, openImport: Boolean(options.importing), returnTo: view === 'editor' ? 'library' : view }); setView('editor'); return; }
    let source = data.cards.filter(c => c.set_id === set.id);
    if (!demo && (set.card_count || 0) > source.length) { setLoading(true); try { source = await fetchAllCards(set.id); } catch (e) { toast((e as Error).message); return; } finally { setLoading(false); } }
    source = [...source].sort((a, b) => a.position - b.position);
    const rows: EditorCard[] = source.map(c => ({ ...pickCard(c), key: c.id, id: c.id }));
    let focusKey = options.focus || null;
    if (options.focus === 'new') { const blank = newEditorCard(); rows.push(blank); focusKey = blank.key; }
    setEditor({ mode: 'edit', setId: set.id, set: toSetDraft(set), cards: rows, original: source, focusKey, openImport: Boolean(options.importing), returnTo: 'set' });
    setView('editor');
  }
  function closeEditor() { editorDirty.current = false; const back = editor?.returnTo || 'library'; setEditor(null); setView(back === 'set' && !selectedId ? 'library' : back); }
  async function saveEditor(draft: SetDraft, rows: EditorCard[]): Promise<boolean> {
    if (!editor) return false;
    setEditorSaving(true);
    const now = new Date().toISOString();
    const fresh = (r: EditorCard, setId: string, position: number) => ({ ...pickCard(r), set_id: setId, tags: [] as string[], favorite: false, difficult: false, mastered: false, position });
    try {
      let setId: string;
      if (editor.mode === 'create') {
        if (demo) {
          setId = crypto.randomUUID();
          const cards = rows.map((r, i): Card => ({ ...fresh(r, setId, i), id: crypto.randomUUID() }));
          updateData(d => ({ ...d, sets: [{ ...draft, id: setId, owner_id: 'demo', created_at: now, updated_at: now, card_count: cards.length }, ...d.sets], cards: [...d.cards, ...cards] }));
        } else {
          const saved: SetRecord = await api('sets', 'POST', draft);
          setId = saved.id;
          const added: Card[] = [];
          for (let i = 0; i < rows.length; i += 500) added.push(...await api('cards', 'POST', rows.slice(i, i + 500).map((r, j) => fresh(r, setId, i + j))));
          updateData(d => ({ ...d, sets: [{ ...saved, card_count: added.length, access_role: 'owner' }, ...d.sets], cards: [...d.cards, ...added] }));
          setOverview(o => ({ ...o, cards: o.cards + added.length }));
        }
        setCardTotal(rows.length);
      } else {
        setId = editor.setId!;
        const record = data.sets.find(s => s.id === setId) || sharedSets.find(s => s.id === setId) || discoveredSets.find(s => s.id === setId);
        const ownsSet = demo || record?.owner_id === userId;
        const original = new Map(editor.original.map(c => [c.id, c]));
        const kept = new Set(rows.flatMap(r => r.id ? [r.id] : []));
        const removed = editor.original.filter(c => !kept.has(c.id));
        const changed = rows.flatMap((r, i) => { const before = r.id ? original.get(r.id) : undefined; return before && (before.position !== i || cardFields.some(f => (before[f] || '') !== (r[f] || ''))) ? [{ r, i }] : []; });
        const created = rows.flatMap((r, i) => r.id ? [] : [{ r, i }]);
        const metaChanged = ownsSet && record && JSON.stringify(toSetDraft(record)) !== JSON.stringify(draft);
        const bump = (s: SetRecord) => s.id === setId ? { ...s, ...(ownsSet ? draft : {}), card_count: rows.length, updated_at: now } : s;
        if (demo) {
          updateData(d => ({ ...d, sets: d.sets.map(bump), cards: [...d.cards.filter(c => c.set_id !== setId), ...rows.map((r, i): Card => r.id ? { ...original.get(r.id)!, ...pickCard(r), position: i } : { ...fresh(r, setId, i), id: crypto.randomUUID() })] }));
        } else {
          if (metaChanged) await api('sets', 'PATCH', { ...draft, id: setId });
          await runLimited(removed.map(c => () => api(`cards?id=${c.id}`, 'DELETE')));
          await runLimited(changed.map(({ r, i }) => () => api('cards', 'PATCH', { ...pickCard(r), id: r.id, position: i })));
          for (let k = 0; k < created.length; k += 500) await api('cards', 'POST', created.slice(k, k + 500).map(({ r, i }) => fresh(r, setId, i)));
          updateData(d => ({ ...d, sets: d.sets.map(bump) }));
          setSharedSets(list => list.map(bump)); setDiscoveredSets(list => list.map(bump));
          if (ownsSet) setOverview(o => ({ ...o, cards: Math.max(0, o.cards + created.length - removed.length) }));
          await loadCards(setId, 0);
        }
        setCardTotal(rows.length);
      }
      editorDirty.current = false;
      toast(editor.mode === 'create' ? `Đã tạo bộ từ với ${rows.length} thẻ.` : 'Đã lưu bộ từ.');
      setEditor(null); setSelectedId(setId); setCardPage(0); setView('set');
      return true;
    } catch (e) {
      toast(`Không lưu được: ${(e as Error).message}`);
      if (!demo && editor.mode === 'edit' && editor.setId) void loadCards(editor.setId, 0);
      return false;
    } finally { setEditorSaving(false); }
  }
  function openFolderForm(folder?: Folder) { setEditingFolder(folder?.id || null); setFolderName(folder?.name || ''); setModal('folder'); }
  async function openShareForm() { if (!activeSet || !ownsActiveSet || demo) return; setShareEmail(''); setShareRole('viewer'); setShareLink(''); setModal('share'); try { setShareInvites(await api(`shares?set=${activeSet.id}`)); } catch (e) { toast((e as Error).message); } }
  async function createShareInvite() { if (!activeSet || !shareEmail.trim()) return toast('Hãy nhập email người nhận.'); try { const invite: ShareInvite = await api('shares', 'POST', { set_id: activeSet.id, email: shareEmail.trim(), role: shareRole }); setShareInvites(old => [invite, ...old.filter(item => item.email !== invite.email)]); const link = `${location.origin}/?invite=${invite.token}`; setShareLink(link); setShareEmail(''); toast('Đã tạo liên kết mời. Hãy sao chép và gửi cho người nhận.'); } catch (e) { toast((e as Error).message); } }
  async function revokeShareInvite(invite: ShareInvite) { if (!confirm(`Thu hồi quyền của ${invite.email}?`)) return; try { await api(`shares?token=${invite.token}`, 'DELETE'); setShareInvites(old => old.filter(item => item.token !== invite.token)); toast('Đã thu hồi quyền truy cập.'); } catch (e) { toast((e as Error).message); } }
  async function saveFolder() { if (!folderName.trim()) return toast('Hãy nhập tên thư mục.'); try { if (demo) { const folder: Folder = { id: editingFolder || crypto.randomUUID(), owner_id: 'demo', name: folderName.trim(), created_at: new Date().toISOString() }; updateData(d => ({ ...d, folders: editingFolder ? (d.folders || []).map(f => f.id === editingFolder ? folder : f) : [...(d.folders || []), folder] })); } else { const folder: Folder = await api('folders', editingFolder ? 'PATCH' : 'POST', editingFolder ? { id: editingFolder, name: folderName.trim() } : { name: folderName.trim() }); updateData(d => ({ ...d, folders: editingFolder ? (d.folders || []).map(f => f.id === editingFolder ? folder : f) : [...(d.folders || []), folder] })); } setModal(null); toast('Đã lưu thư mục.'); } catch (e) { toast((e as Error).message); } }
  async function deleteFolder(folder: Folder) { if (!confirm(`Xóa thư mục “${folder.name}”? Các bộ từ trong thư mục sẽ được chuyển ra ngoài.`)) return; try { if (!demo) await api(`folders?id=${folder.id}`, 'DELETE'); updateData(d => ({ ...d, folders: (d.folders || []).filter(f => f.id !== folder.id), sets: d.sets.map(s => s.folder_id === folder.id ? { ...s, folder_id: null } : s) })); setFolderFilter('all'); toast('Đã xóa thư mục.'); } catch (e) { toast((e as Error).message); } }
  async function deleteSet(set: SetRecord) {
    if (!confirm(`Xóa bộ “${set.title}” và toàn bộ thẻ? Thao tác này không thể hoàn tác.`)) return;
    try { if (!demo) await api(`sets?id=${set.id}`, 'DELETE'); updateData(d => ({ ...d, sets: d.sets.filter(s => s.id !== set.id), cards: d.cards.filter(c => c.set_id !== set.id) })); setSelectedId(null); setView('library'); toast('Đã xóa bộ từ.'); } catch (e) { toast((e as Error).message); }
  }
  async function deleteCard(card: Card) { if (!confirm(`Xóa thẻ “${card.term}”?`)) return; try { if (!demo) await api(`cards?id=${card.id}`, 'DELETE'); updateData(d => ({ ...d, cards: d.cards.filter(c => c.id !== card.id), sets: d.sets.map(s => s.id === card.set_id ? { ...s, card_count: Math.max(0, (s.card_count || 0) - 1) } : s) })); setCardTotal(n => Math.max(0, n - 1)); if (!demo) setOverview(o => ({ ...o, cards: Math.max(0, o.cards - 1), mastered: Math.max(0, o.mastered - Number(card.progress?.state === 'mastered')) })); toast('Đã xóa thẻ.'); } catch (e) { toast((e as Error).message); } }
  async function toggleCard(card: Card, field: 'favorite' | 'difficult' | 'mastered') { try { if (!demo) await api('cards', 'PATCH', { id: card.id, [field]: !card[field] }); updateData(d => ({ ...d, cards: d.cards.map(c => c.id === card.id ? { ...c, [field]: !card[field] } : c) })); } catch (e) { toast((e as Error).message); } }
  async function duplicateSet(set: SetRecord) {
    try {
      const sourceCards = demo ? data.cards.filter(c => c.set_id === set.id) : await fetchAllCards(set.id);
      const copy = { ...set, title: `${set.title} (bản sao)`, visibility: 'private' as const, folder_id: null };
      let id: string;
      if (demo) id = crypto.randomUUID(); else id = (await api('sets', 'POST', { title: copy.title, description: copy.description, source_language: copy.source_language, target_language: copy.target_language, visibility: 'private', tags: copy.tags, cover_color: copy.cover_color })).id;
      const cards = sourceCards.map((c, i) => ({ ...c, id: crypto.randomUUID(), set_id: id, position: i, progress: undefined }));
      if (!demo) for (let i = 0; i < cards.length; i += 500) await api('cards', 'POST', cards.slice(i, i + 500).map(({ id: _id, progress: _progress, created_at: _created, ...rest }) => rest));
      updateData(d => ({ ...d, sets: [{ ...copy, id, owner_id: demo ? 'demo' : userId!, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), card_count: cards.length }, ...d.sets], cards: demo ? [...d.cards, ...cards] : d.cards }));
      toast('Đã nhân bản bộ từ.');
    } catch (e) { toast((e as Error).message); }
  }
  async function fetchAllCards(setId: string): Promise<Card[]> { const rows: Card[] = []; for (let page = 0; ; page++) { const result = await api(`cards?set=${setId}&page=${page}`); rows.push(...result.cards); if (rows.length >= result.total || !result.cards.length) break; } return rows; }
  async function exportSet(set: SetRecord, format: 'csv' | 'tsv' | 'json') { try { const cards = demo ? data.cards.filter(c => c.set_id === set.id) : await fetchAllCards(set.id); const fields = ['term', 'definition', 'phonetic', 'example', 'example_translation', 'notes', 'synonyms', 'antonyms'] as const; const content = format === 'json' ? JSON.stringify({ set: { title: set.title, description: set.description, source_language: set.source_language, target_language: set.target_language }, cards: cards.map(c => Object.fromEntries(fields.map(f => [f, c[f]]))) }, null, 2) : [fields.join(format === 'csv' ? ',' : '\t'), ...cards.map(c => fields.map(f => csvEscape(c[f], format === 'csv' ? ',' : '\t')).join(format === 'csv' ? ',' : '\t'))].join('\r\n'); download(`${set.title.replace(/[^\p{L}\p{N}-]+/gu, '-')}.${format}`, content, format === 'json' ? 'application/json' : 'text/plain;charset=utf-8'); } catch (e) { toast((e as Error).message); } }
  async function saveSession(mode: Session['mode'], resultCorrect: number, total: number) { const setId = selectedId || deck[0]?.set_id; if (!setId) return; const entry: Session = { id: crypto.randomUUID(), set_id: setId, mode, correct: resultCorrect, total, duration_seconds: Math.max(1, Math.round((Date.now() - studyStart) / 1000)), created_at: new Date().toISOString() }; try { if (!demo) await api('activity', 'POST', { kind: 'session', set_id: setId, mode, correct: resultCorrect, total, duration_seconds: entry.duration_seconds }); updateData(d => ({ ...d, sessions: [entry, ...d.sessions] })); } catch (e) { toast((e as Error).message); } }
  async function rateCard(card: Card, rating: Rating) { try { const next: Progress = demo ? { ...scheduleReview(card.progress, rating), card_id: card.id, user_id: 'demo' } : await api('activity', 'POST', { kind: 'review', card_id: card.id, rating }); updateData(d => ({ ...d, cards: d.cards.map(c => c.id === card.id ? { ...c, progress: next, mastered: next.state === 'mastered' } : c) })); if (!demo) setOverview(o => ({ ...o, due: Math.max(0, o.due - Number(Boolean(card.progress && new Date(card.progress.due_at) <= new Date()))), mastered: Math.max(0, o.mastered + Number(next.state === 'mastered') - Number(card.progress?.state === 'mastered')) })); } catch (e) { toast((e as Error).message); } }
  async function beginMode(mode: View, globalReview = false) {
    let source = mode === 'review' ? (globalReview ? allCards : activeCards).filter(c => !c.progress || new Date(c.progress.due_at) <= new Date()) : activeCards;
    if (mode === 'review' && globalReview) { setSelectedId(null); if (!demo) { try { source = []; for (let page = 0; ; page++) { const result = await api(`review?page=${page}`); source.push(...result.cards); if ((page + 1) * 100 >= result.total || !result.cards.length) break; } } catch (e) { toast((e as Error).message); return; } } }
    else if (!demo && selectedId && mode !== 'review' && (activeSet?.card_count || 0) > activeCards.length) {
      try { source = await fetchAllCards(selectedId); } catch (e) { toast((e as Error).message); return; }
    }
    else if (!demo && selectedId && mode === 'review' && (activeSet?.card_count || 0) > activeCards.length) {
      try { source = (await fetchAllCards(selectedId)).filter(c => !c.progress || new Date(c.progress.due_at) <= new Date()); } catch (e) { toast((e as Error).message); return; }
    }
    setStudySource(source);
    let filtered = source.filter(c => filter === 'all' || (filter === 'unmastered' && !c.mastered) || (filter === 'difficult' && c.difficult) || (filter === 'favorite' && c.favorite));
    if (mode === 'review' && demo && globalReview && !filtered.length) filtered = allCards.filter(c => !c.mastered);
    const next = shuffle(filtered);
    setDeck(next); setIndex(0); setFlipped(false); if (mode === 'learn') setReverse(false); setStudyStart(Date.now()); setElapsed(0); setCorrect(0); setAnswered(0); setAnswer(''); setFeedback(null); setLearnStages({}); setLearnChoice(''); setLearnMastered([]); setLearnAttempts(0); setLearnTotal(next.length); setMatched([]); setMatchSelection(null); setWrongMatch(false); setTestAnswers({}); setTestDone(false); setTestStarted(false); setTestNumber(Math.min(10, next.length));
    const uniquePairs = next.filter((card, position, cards) => cards.findIndex(c => normalizeAnswer(c.term) === normalizeAnswer(card.term) || normalizeAnswer(c.definition) === normalizeAnswer(card.definition)) === position).slice(0, 6);
    setMatchTerms(shuffle(uniquePairs)); setMatchDefinitions(shuffle(uniquePairs)); setView(mode);
  }
  function nextCard() { setIndex(i => i + 1); setFlipped(false); setAnswer(''); setFeedback(null); }
  function previousCard() { setIndex(i => Math.max(0, i - 1)); setFlipped(false); setAnswer(''); setFeedback(null); }
  function changeFilter(next: typeof filter) { setFilter(next); const filtered = studySource.filter(c => next === 'all' || (next === 'unmastered' && !c.mastered) || (next === 'difficult' && c.difficult) || (next === 'favorite' && c.favorite)); setDeck(shuffle(filtered)); setIndex(0); setFlipped(false); }
  function startTest() { const selected = deck.slice(0, Math.min(testNumber, deck.length)); const choices: Record<string, string[]> = {}; selected.forEach(card => { const distractors = shuffle([...new Set(deck.filter(c => c.id !== card.id).map(c => c.definition).filter(d => normalizeAnswer(d) !== normalizeAnswer(card.definition)))]).slice(0, 3); choices[card.id] = shuffle([card.definition, ...distractors]); }); setDeck(selected); setTestChoices(choices); setTestStarted(true); setStudyStart(Date.now()); }
  useEffect(() => { if (view !== 'flashcards') return; const handler = (e: KeyboardEvent) => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return; if (e.code === 'Space') { e.preventDefault(); setFlipped(f => !f); } if (e.code === 'ArrowRight') nextCard(); if (e.code === 'ArrowLeft') previousCard(); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [view]);
  async function submitLearn(value = answer, skip = false) {
    const card = deck[index];
    if (!card || feedback) return;
    const stage = learnStages[card.id] || (learnTotal < 2 ? 'typing' : 'choice');
    if (stage === 'typing' && !value.trim() && !skip) return;
    const ok = normalizeAnswer(value) === normalizeAnswer(reverse ? card.term : card.definition);
    setFeedback(ok ? 'correct' : 'wrong'); setLearnAttempts(n => n + 1);
    if (stage === 'choice') setLearnChoice(value);
    if (stage === 'typing' && ok) { setLearnMastered(ids => [...ids, card.id]); setCorrect(n => n + 1); }
    else setDeck(cards => [...cards, card]);
    if (!ok || stage === 'typing') await rateCard(card, ok ? 'good' : 'again');
  }
  function advanceLearn() {
    const card = deck[index];
    if (!card || !feedback) return;
    if (feedback === 'correct' && (learnStages[card.id] || (learnTotal < 2 ? 'typing' : 'choice')) === 'choice') setLearnStages(stages => ({ ...stages, [card.id]: 'typing' }));
    if (index + 1 >= deck.length) { void saveSession('learn', learnMastered.length, learnTotal); setIndex(deck.length); }
    else { nextCard(); setLearnChoice(''); }
  }
  function chooseMatch(type: 'term' | 'definition', id: string) { if (matched.includes(id)) return; if (!matchSelection) return setMatchSelection({ type, id }); if (matchSelection.type === type) return setMatchSelection({ type, id }); if (matchSelection.id === id) { const next = [...matched, id]; setMatched(next); setMatchSelection(null); setCorrect(c => c + 1); if (next.length === matchTerms.length) saveSession('match', next.length, next.length); } else { setWrongMatch(true); setTimeout(() => { setWrongMatch(false); setMatchSelection(null); }, 500); } }
  async function finishTest() { const result = deck.reduce((sum, c) => sum + Number(normalizeAnswer(testAnswers[c.id] || '') === normalizeAnswer(c.definition)), 0); setCorrect(result); setTestDone(true); await saveSession('test', result, deck.length); }
  async function saveProfile() { try { if (!demo) await api('activity', 'POST', { kind: 'profile', display_name: profileName, learning_language: learningLanguage, daily_goal: dailyGoal }); updateData(d => ({ ...d, profile: { id: userId || 'demo', display_name: profileName, learning_language: learningLanguage, daily_goal: dailyGoal } })); toast('Đã lưu cài đặt.'); } catch (e) { toast((e as Error).message); } }
  async function doAuth(e: React.FormEvent) { e.preventDefault(); const client = supabase(); if (!client) return; setLoading(true); try { if (authMode === 'signup') { const { error } = await client.auth.signUp({ email: authEmail, password: authPassword, options: { data: { display_name: authEmail.split('@')[0] } } }); if (error) throw error; toast('Kiểm tra email để xác nhận tài khoản.'); } else if (authMode === 'login') { const { error } = await client.auth.signInWithPassword({ email: authEmail, password: authPassword }); if (error) throw error; } else if (authMode === 'update') { const { error } = await client.auth.updateUser({ password: authPassword }); if (error) throw error; setAuthMode('login'); toast('Mật khẩu đã được cập nhật.'); } else { const { error } = await client.auth.resetPasswordForEmail(authEmail, { redirectTo: location.origin }); if (error) throw error; toast('Đã gửi email đặt lại mật khẩu.'); } } catch (e) { toast((e as Error).message); } finally { setLoading(false); } }
  async function signInGoogle() { const client = supabase(); if (!client) return; const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href } }); if (error) toast(error.message); }
  async function signOut() { await supabase()?.auth.signOut(); setUserId(null); setDemo(false); setData({ sets: [], cards: [], sessions: [], profile: null }); setView('dashboard'); }

  const filteredSets = useMemo(() => data.sets.filter(s => (folderFilter === 'all' || s.folder_id === folderFilter) && `${s.title} ${s.description} ${(s.tags || []).join(' ')}`.toLowerCase().includes(search.toLowerCase())), [data.sets, search, folderFilter]);
  const activityByDay = useMemo(() => Array.from({ length: 7 }, (_, i) => { const date = new Date(); date.setDate(date.getDate() - (6 - i)); return { label: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()], value: data.sessions.filter(s => new Date(s.created_at).toDateString() === date.toDateString()).reduce((n, s) => n + s.total, 0) }; }), [data.sessions]);

  useEffect(() => { if (!modal) return; const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModal(null); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [modal]);

  const inStudy = studyViews.includes(view);
  const goalPercent = Math.min(100, Math.round(todayReviewed / goal * 100));
  const setBackView: View = activeSet && !ownsActiveSet ? sharedSets.some(s => s.id === activeSet.id) ? 'shared' : 'discover' : 'library';
  /** Search lives on the Library/Discover pages; the header button jumps there and focuses it. */
  function openSearch() { if (view !== 'library' && view !== 'discover' && !go('library')) return; setTimeout(() => document.getElementById('page-search')?.focus(), 250); }
  const searchBox = <div className="search page-search"><Search size={17} /><input id="page-search" type="search" aria-label="Tìm kiếm bộ từ" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm bộ từ, chủ đề…" />{search && <button className="icon-button plain" aria-label="Xoá tìm kiếm" onClick={() => setSearch('')}><X size={15} /></button>}</div>;
  const exitDemo = () => { setDemo(false); setData({ sets: [], cards: [], sessions: [], profile: null }); };

  if (!authReady) return <div className="splash"><div className="brand-mark"><Heart size={20} fill="currentColor" /></div><div className="skeleton" style={{ width: 180, height: 14 }} /></div>;

  if ((!userId && !demo) || authMode === 'update') return <div className="auth-shell">
    <div className="auth-visual">
      <div className="brand"><div className="brand-mark"><Heart size={18} fill="currentColor" /></div>VanLet</div>
      <div>
        <span className="eyebrow">Học từ vựng nhẹ nhàng mỗi ngày</span>
        <h1>Học ít mỗi ngày,<br />nhớ lâu cả đời.</h1>
        <p>Tạo bộ từ trong vài giây, rồi học bằng thẻ lật, câu hỏi chọn đáp án, trò ghép cặp và ôn lại đúng lúc.</p>
        <ul className="auth-points">
          <li><Check size={16} /> Dán cả danh sách từ Excel hay Google Docs chỉ một lần</li>
          <li><Check size={16} /> Tự nhắc bạn ôn lại đúng lúc sắp quên</li>
          <li><Check size={16} /> Học trên điện thoại hay máy tính đều được, chia sẻ với bạn bè</li>
        </ul>
      </div>
      <div className="auth-cards" aria-hidden="true"><div className="auth-card one"><small>Từ</small><strong>serendipity</strong></div><div className="auth-card two"><small>Nghĩa</small><strong>sự tình cờ may mắn</strong></div></div>
    </div>
    <div className="auth-form-wrap"><div className="auth-box">
      <div className="brand mobile-only"><div className="brand-mark"><Heart size={18} fill="currentColor" /></div>VanLet</div>
      <h1>{authMode === 'login' ? 'Chào mừng trở lại' : authMode === 'signup' ? 'Tạo tài khoản' : authMode === 'update' ? 'Tạo mật khẩu mới' : 'Đặt lại mật khẩu'}</h1>
      <p className="muted">{configured ? 'Lưu bộ từ và tiến độ học để học tiếp trên mọi thiết bị.' : 'Hiện chưa đăng nhập được. Bạn vẫn có thể dùng thử ngay trên máy này.'}</p>
      {configured && googleEnabled && authMode !== 'reset' && authMode !== 'update' && <button className="btn block" onClick={signInGoogle}><Globe2 /> Tiếp tục với Google</button>}
      {configured && googleEnabled && authMode !== 'reset' && authMode !== 'update' && <div className="divider"><span>hoặc dùng email</span></div>}
      {configured && <form onSubmit={doAuth}>
        {authMode !== 'update' && <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="ban@email.com" /></label>}
        {authMode !== 'reset' && <label className="field"><span>Mật khẩu</span><input className="input" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={6} required value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="Ít nhất 6 ký tự" /></label>}
        {authMode === 'login' && <div className="auth-forgot"><button type="button" className="link" onClick={() => setAuthMode('reset')}>Quên mật khẩu?</button></div>}
        <button className="btn primary block big" disabled={loading}>{loading ? 'Đang xử lý…' : authMode === 'login' ? 'Đăng nhập' : authMode === 'signup' ? 'Đăng ký' : authMode === 'update' ? 'Lưu mật khẩu mới' : 'Gửi email đặt lại'}</button>
        <p className="auth-switch">{authMode === 'signup' ? 'Đã có tài khoản?' : authMode === 'login' ? 'Mới dùng VanLet?' : ''} <button type="button" className="link" onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>{authMode === 'login' ? 'Tạo tài khoản' : 'Đăng nhập'}</button></p>
      </form>}
      {authMode !== 'update' && <><div className="divider"><span>{configured ? 'hoặc' : 'bắt đầu'}</span></div>
      <button className="btn soft block" onClick={() => setDemo(true)}>Dùng thử không cần tài khoản <ArrowRight size={15} /></button>
      <p className="muted small-note">Khi dùng thử, dữ liệu chỉ lưu trên máy này. Đăng nhập để giữ lâu dài.</p></>}
    </div></div>
    {message && <div className="toast" role="status" aria-live="polite">{message}</div>}
  </div>;

  return <div className={`app ${inStudy ? 'focus-mode' : ''}`}>
    <a className="skip-link" href="#main">Bỏ qua đến nội dung chính</a>
    {!inStudy && <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => go('dashboard')} aria-label="VanLet – về trang chủ"><span className="brand-mark"><Heart size={17} fill="currentColor" /></span>VanLet</button>
        <nav className="top-nav" aria-label="Điều hướng chính">
          {headerNav.map(item => <button key={item.id} title={item.name} className={`top-link ${view === item.id ? 'active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => navTo(item.id)}><item.icon /><span>{item.name}</span>{item.id === 'review' && dueCount > 0 && <span className="nav-badge">{dueCount}</span>}</button>)}
        </nav>
        <div className="top-actions">
          {demo && <span className="badge-demo" title="Dữ liệu chỉ lưu trên máy này">Dùng thử</span>}
          <button className="icon-button" aria-label="Tìm bộ từ" title="Tìm bộ từ" onClick={openSearch}><Search size={17} /></button>
          <button className="icon-button" aria-label={dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} title={dark ? 'Giao diện sáng' : 'Giao diện tối'} onClick={() => setDark(v => !v)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="btn primary small top-create" onClick={() => openEditor()}><Plus /> Tạo bộ từ</button>
          <button className="avatar" aria-label="Hồ sơ và cài đặt" title="Hồ sơ và cài đặt" onClick={() => go('settings')}>{(data.profile?.display_name || 'V').charAt(0).toUpperCase()}</button>
        </div>
      </div>
    </header>}

    <main className="main" id="main">

      <div className={`content ${view === 'editor' ? 'narrow' : ''}`}><AnimatePresence mode="wait"><motion.div key={view + (selectedId || '')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .16 }}>

        {view === 'dashboard' && <>
          <div className="welcome"><h1>Chào {data.profile?.display_name || 'bạn'} 👋</h1><p>Mỗi từ mới là một bước gần hơn đến mục tiêu của bạn.</p></div>
          <div className="hero">
            <div className="hero-copy">
              <span className="eyebrow">Tiếp tục hành trình</span>
              <h2>{dueCount ? `${dueCount} từ đang chờ bạn ôn lại` : 'Hôm nay học gì nhỉ?'}</h2>
              <p>{dueCount ? 'Ôn lại ngay bây giờ để nhớ lâu hơn. Chỉ mất vài phút thôi.' : 'Hôm nay chưa có từ nào cần ôn. Học một bộ từ hoặc tự tạo bộ từ mới nhé.'}</p>
              <div className="row wrap">{dueCount ? <button className="btn primary" onClick={() => beginMode('review', true)}>Bắt đầu ôn tập <ArrowRight size={16} /></button> : <button className="btn primary" onClick={() => openEditor()}><Plus /> Tạo bộ từ</button>}<button className="btn" onClick={() => go('library')}>Mở thư viện</button></div>
            </div>
            <div className="hero-visual" aria-hidden="true"><div className="hero-card back" /><div className="hero-card"><small>Từ</small><strong>resilient</strong><span /></div></div>
          </div>
          <div className="stats-grid">
            <Stat icon={LibraryBig} label="Bộ từ" value={data.sets.length} caption="Sẵn sàng để học" tone="violet" />
            <Stat icon={BookOpen} label="Tổng số thẻ" value={totalCards} caption="Trong thư viện" tone="green" />
            <Stat icon={Check} label="Đã thuộc" value={mastered} caption="Từ đã nhớ chắc" tone="blue" />
            <Stat icon={Clock3} label="Cần ôn hôm nay" value={dueCount} caption="Ôn để không quên" tone="amber" />
          </div>
          <div className="section-heading between"><h2>Bộ từ gần đây</h2><button className="btn ghost small" onClick={() => go('library')}>Xem tất cả <ArrowRight /></button></div>
          {data.sets.length ? <div className="set-grid">{data.sets.slice(0, 3).map(s => <SetCard key={s.id} set={s} onClick={() => openSet(s.id)} />)}</div> : <Empty title="Tạo bộ từ đầu tiên" text="Gõ hoặc dán danh sách từ của bạn – chỉ mất chưa đến một phút." action="Tạo bộ từ" onClick={() => openEditor()} />}
          <div className="two-col" style={{ marginTop: 32 }}>
            <section className="panel"><div className="between"><div><h2>Hoạt động học tập</h2><span className="muted small">7 ngày gần đây · {activityByDay.reduce((n, d) => n + d.value, 0)} lượt</span></div><button className="btn ghost small" onClick={() => go('stats')}>Thống kê <ArrowRight /></button></div><ActivityChart days={activityByDay} height={170} /></section>
            <section className="panel goal-panel"><div className="between"><div className="tone-icon violet"><Target size={20} /></div><span className="pill">{goalPercent}%</span></div><h3>{todayReviewed} / {goal} lượt học</h3><p className="muted small">Mục tiêu hôm nay – một chút mỗi ngày, khác biệt lâu dài.</p><div className="progress-track" role="progressbar" aria-label="Mục tiêu hôm nay" aria-valuenow={goalPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${goalPercent}%` }} /></div><div className="row muted small" style={{ marginTop: 16 }}><Clock3 size={15} /> {todayMinutes} phút học hôm nay</div></section>
          </div>
        </>}

        {view === 'library' && <>
          <div className="between mobile-stack welcome"><div><h1>Thư viện của bạn</h1><p>{filteredSets.length} bộ từ · {data.sets.reduce((n, s) => n + (s.card_count || data.cards.filter(c => c.set_id === s.id).length), 0)} thẻ</p></div><button className="btn primary" onClick={() => openEditor()}><Plus /> Tạo bộ từ</button></div>
          {searchBox}
          <FolderBar folders={data.folders || []} selected={folderFilter} onSelect={setFolderFilter} onAdd={() => openFolderForm()} onEdit={openFolderForm} onDelete={deleteFolder} />
          {loading ? <div className="set-grid">{[1, 2, 3].map(n => <div className="skeleton" key={n} style={{ height: 196 }} />)}</div>
            : filteredSets.length ? <div className="set-grid">{filteredSets.map(s => <SetCard key={s.id} set={s} onClick={() => openSet(s.id)} />)}</div>
            : <Empty title={search ? 'Không tìm thấy bộ từ' : 'Thư viện đang trống'} text={search ? 'Thử một từ khóa khác.' : 'Tạo bộ từ đầu tiên và bắt đầu hành trình.'} action={search ? 'Xóa tìm kiếm' : 'Tạo bộ từ'} onClick={() => search ? setSearch('') : openEditor()} />}
          {!demo && !search && data.sets.length < setsTotal && <div className="center-row"><button className="btn" onClick={loadMoreSets}>Tải thêm bộ từ <ChevronRight /></button></div>}
        </>}

        {view === 'shared' && <SharedPanel sets={sharedSets} total={sharedTotal} onOpen={openSet} onMore={() => loadShared(sharedPage + 1)} />}
        {view === 'discover' && <DiscoverPanel searchBox={searchBox} sets={discoveredSets} total={discoveredTotal} onOpen={openSet} onMore={() => loadDiscover(discoveredPage + 1, search)} onCreate={() => openEditor()} />}

        {view === 'editor' && editor && <SetEditor key={editor.setId || 'new'} mode={editor.mode} initialSet={editor.set} initialCards={editor.cards} canEditMeta={editor.mode === 'create' || demo || (data.sets.find(s => s.id === editor.setId) || sharedSets.find(s => s.id === editor.setId) || discoveredSets.find(s => s.id === editor.setId))?.owner_id === userId} folders={data.folders || []} focusKey={editor.focusKey} openImport={editor.openImport} saving={editorSaving} onCancel={closeEditor} onSave={saveEditor} onDirtyChange={dirty => { editorDirty.current = dirty; }} notify={toast} />}

        {view === 'set' && activeSet && <>
          <button className="btn ghost small back-link" onClick={() => go(setBackView)}><ChevronLeft /> {setBackView === 'library' ? 'Thư viện' : setBackView === 'shared' ? 'Được chia sẻ' : 'Khám phá'}</button>
          <div className="set-header">
            <div>
              <h1>{activeSet.title}</h1>
              <div className="set-header-meta"><span className="pill">{activeSet.source_language} → {activeSet.target_language}</span><span>{demo ? activeCards.length : cardTotal} thẻ</span><span>{activeSet.visibility === 'public' ? <><Globe2 size={13} /> Công khai</> : 'Riêng tư'}</span>{(activeSet.tags || []).map(t => <span key={t} className="tag">#{t}</span>)}</div>
              {activeSet.description && <p className="muted">{activeSet.description}</p>}
            </div>
            <div className="row wrap">
              {canEditActiveCards && <button className="btn" onClick={() => openEditor(activeSet)}><Pencil /> Chỉnh sửa</button>}
              {ownsActiveSet && !demo && <button className="btn" onClick={openShareForm}><Users /> Mời học cùng</button>}
              {ownsActiveSet && <button className="icon-button danger" onClick={() => deleteSet(activeSet)} aria-label="Xóa bộ từ" title="Xóa bộ từ"><Trash2 size={17} /></button>}
            </div>
          </div>
          <div className="mode-grid">{modes.map(m => <button key={m.id} className={`mode-card ${m.tone}`} onClick={() => beginMode(m.id)}><span className={`tone-icon ${m.tone}`}><m.icon size={20} /></span><span><strong>{m.name}</strong><small>{m.desc}</small></span></button>)}</div>
          {activeCards.length > 0 && <SetPreview key={activeSet.id} cards={activeCards} onExpand={() => beginMode('flashcards')} onSpeak={text => { if (!pronounce(text, activeSet.source_language)) toast('Trình duyệt này không hỗ trợ phát âm.'); }} />}
          <div className="between mobile-stack section-heading terms-heading"><h2>Các từ trong bộ này <span className="muted">({demo ? activeCards.length : cardTotal})</span></h2>{canEditActiveCards && <div className="row wrap"><button className="btn" onClick={() => openEditor(activeSet, { importing: true })}><FileUp /> Nhập</button><button className="btn primary" onClick={() => openEditor(activeSet, { focus: 'new' })}><Plus /> Thêm thẻ</button></div>}</div>
          {activeCards.length ? <ul className="term-list">{activeCards.map(c => <li className="term-row" key={c.id}>
            <div className="term-cell"><strong>{c.term}</strong>{c.phonetic && <small>{c.phonetic}</small>}</div>
            <div className="def-cell">{c.definition}{c.example && <small>{c.example}</small>}</div>
            <div className="term-actions">
              <button className={`icon-button plain ${c.favorite ? 'starred' : ''}`} aria-label={c.favorite ? `Bỏ đánh dấu sao “${c.term}”` : `Đánh dấu sao “${c.term}”`} aria-pressed={c.favorite} disabled={!canEditActiveCards} onClick={() => toggleCard(c, 'favorite')}><Star size={17} fill={c.favorite ? 'currentColor' : 'none'} /></button>
              <button className="icon-button plain" aria-label={`Nghe “${c.term}”`} onClick={() => { if (!pronounce(c.term, activeSet.source_language)) toast('Trình duyệt này không hỗ trợ phát âm.'); }}><Volume2 size={17} /></button>
              {canEditActiveCards && <button className="icon-button plain" aria-label={`Sửa “${c.term}”`} onClick={() => openEditor(activeSet, { focus: c.id })}><Pencil size={16} /></button>}
              {canEditActiveCards && <button className="icon-button plain" aria-label={`Xóa “${c.term}”`} onClick={() => deleteCard(c)}><Trash2 size={16} /></button>}
            </div>
          </li>)}</ul> : <Empty title="Chưa có thẻ nào" text={canEditActiveCards ? 'Gõ từng thẻ hoặc dán cả danh sách từ Excel, Google Docs.' : 'Chủ sở hữu chưa thêm thẻ nào.'} action={canEditActiveCards ? 'Thêm thẻ' : 'Quay lại'} onClick={() => canEditActiveCards ? openEditor(activeSet, { focus: 'new' }) : go(setBackView)} />}
          {!demo && cardTotal > 100 && <div className="center-row"><button className="btn" disabled={cardPage === 0} onClick={() => loadCards(activeSet.id, cardPage - 1)}><ChevronLeft /> Trang trước</button><span className="muted">Trang {cardPage + 1}/{Math.ceil(cardTotal / 100)}</span><button className="btn" disabled={(cardPage + 1) * 100 >= cardTotal} onClick={() => loadCards(activeSet.id, cardPage + 1)}>Trang sau <ChevronRight /></button></div>}
          {canEditActiveCards && activeCards.length > 0 && <div className="center-row"><button className="btn soft big" onClick={() => openEditor(activeSet)}><Pencil /> Thêm hoặc xóa từ</button></div>}
          <div className="set-secondary"><span className="muted small">Thêm</span><button className="btn ghost small" onClick={() => duplicateSet(activeSet)}><Copy /> Nhân bản</button><button className="btn ghost small" onClick={() => exportSet(activeSet, 'csv')}><Download /> Tải về (mở bằng Excel)</button>{activeSet.visibility === 'public' && <button className="btn ghost small" onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}/?set=${activeSet.id}`); toast('Đã sao chép liên kết. Người xem cần đăng nhập.'); } catch { toast('Không thể sao chép liên kết.'); } }}><Globe2 /> Sao chép liên kết</button>}</div>
        </>}

        {inStudy && <div className="study-wrap">
          <div className="study-top">
            <button className="btn ghost small" onClick={() => setView(selectedId ? 'set' : 'dashboard')}><X /> Thoát</button>
            <div className="study-title"><span className={`tone-icon sm ${modes.find(m => m.id === view)?.tone}`}>{(() => { const M = modes.find(m => m.id === view)?.icon || Layers3; return <M size={15} />; })()}</span><strong>{modes.find(m => m.id === view)?.name}</strong>{activeSet && <span className="muted hide-sm">· {activeSet.title}</span>}</div>
            <span className="study-count">{view === 'learn' ? `${learnMastered.length}/${learnTotal}` : view === 'match' ? `${matched.length}/${matchTerms.length}` : `${Math.min(index + 1, deck.length)}/${deck.length}`}</span>
          </div>
          {view !== 'test' && <div className="study-progress" role="progressbar" aria-label="Tiến độ" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view === 'learn' ? learnMastered.length / Math.max(1, learnTotal) * 100 : view === 'match' ? matched.length / Math.max(1, matchTerms.length) * 100 : Math.min(index + 1, deck.length) / Math.max(1, deck.length) * 100)}><span style={{ width: `${view === 'learn' ? learnMastered.length / Math.max(1, learnTotal) * 100 : view === 'match' ? matched.length / Math.max(1, matchTerms.length) * 100 : Math.min(index + 1, deck.length) / Math.max(1, deck.length) * 100}%` }} /></div>}
          {deck.length === 0 ? <Empty title="Chưa có thẻ để học" text="Thêm thẻ vào bộ từ, hoặc quay lại sau khi có từ cần ôn." action="Về thư viện" onClick={() => setView('library')} /> : <>

            {view === 'flashcards' && <>
              {index >= deck.length ? <Result correct={correct} total={deck.length} onAgain={() => beginMode('flashcards')} onBack={() => setView('set')} /> : <>
                <FlipCard flipped={flipped} onFlip={() => setFlipped(v => !v)}
                  frontLabel={reverse ? 'Nghĩa' : 'Từ'} backLabel={reverse ? 'Từ' : 'Nghĩa'}
                  front={reverse ? deck[index]?.definition : deck[index]?.term} back={reverse ? deck[index]?.term : deck[index]?.definition}
                  frontHint={showHints && !reverse ? deck[index]?.phonetic : ''} backHint={showHints ? deck[index]?.example : ''} />
                <div className="fc-nav">
                  <button className="icon-button round big" aria-label="Thẻ trước (←)" disabled={index === 0} onClick={previousCard}><ChevronLeft /></button>
                  <span className="fc-count">{index + 1} / {deck.length}</span>
                  <button className="icon-button round big" aria-label="Thẻ tiếp (→)" onClick={async () => { if (index + 1 >= deck.length) { await saveSession('flashcards', correct, deck.length); setIndex(deck.length); } else nextCard(); }}><ChevronRight /></button>
                </div>
                <div className="fc-toolbar">
                  <select className="select compact" aria-label="Lọc thẻ" value={filter} onChange={e => changeFilter(e.target.value as typeof filter)}><option value="all">Tất cả thẻ</option><option value="unmastered">Chưa thuộc</option><option value="difficult">Từ khó</option><option value="favorite">Đã gắn sao</option></select>
                  <button className="btn ghost small" onClick={() => { setDeck(shuffle(deck)); setIndex(0); setFlipped(false); }}><Shuffle /> Trộn</button>
                  <button className="btn ghost small" onClick={() => { setReverse(v => !v); setFlipped(false); }}><ArrowLeftRight /> Đổi mặt</button>
                  <button className="btn ghost small" aria-pressed={showHints} onClick={() => setShowHints(v => !v)}>{showHints ? <EyeOff /> : <Eye />} {showHints ? 'Ẩn gợi ý' : 'Hiện gợi ý'}</button>
                  <button className="btn ghost small" onClick={() => { if (!pronounce(deck[index]?.term || '', activeSet?.source_language)) toast('Trình duyệt này không hỗ trợ phát âm.'); }}><Volume2 /> Nghe</button>
                </div>
                <div className="fc-mark">
                  <button className={`btn small ${deck[index]?.difficult ? 'warn' : ''}`} aria-pressed={deck[index]?.difficult} onClick={() => { toggleCard(deck[index], 'difficult'); toast(deck[index].difficult ? 'Đã bỏ đánh dấu từ khó.' : 'Đã đánh dấu từ khó.'); }}><Flame /> Từ khó</button>
                  <button className={`btn small ${deck[index]?.mastered ? 'success' : ''}`} aria-pressed={deck[index]?.mastered} onClick={() => { if (!deck[index].mastered) { toggleCard(deck[index], 'mastered'); setCorrect(n => n + 1); } }}><Check /> Đã thuộc</button>
                </div>
                <p className="kbd-hint"><kbd>Space</kbd> lật thẻ · <kbd>←</kbd> <kbd>→</kbd> chuyển thẻ</p>
              </>}
            </>}

            {view === 'learn' && <LearnPanel card={deck[index]} stage={learnStages[deck[index]?.id] || (learnTotal < 2 ? 'typing' : 'choice')} options={learnOptions} choice={learnChoice} answer={answer} feedback={feedback} mastered={learnMastered.length} total={learnTotal} attempts={learnAttempts} onChoice={value => { void submitLearn(value); }} onAnswer={setAnswer} onSubmit={() => { void submitLearn(); }} onSkip={() => { void submitLearn('', true); }} onNext={advanceLearn} onRestart={() => beginMode('learn')} onBack={() => setView('set')} />}

            {view === 'review' && <>{index >= deck.length ? <Result correct={correct} total={deck.length} onAgain={() => beginMode('review')} onBack={() => setView(selectedId ? 'set' : 'dashboard')} /> : <>
              <FlipCard flipped={flipped} onFlip={() => setFlipped(v => !v)} frontLabel="Bạn còn nhớ từ này?" backLabel="Nghĩa" front={deck[index].term} back={deck[index].definition} frontHint={deck[index].phonetic} backHint={deck[index].example} />
              {flipped ? <div className="rating-row">{(['again', 'hard', 'good', 'easy'] as Rating[]).map((rating, i) => <button className={`rating ${rating}`} key={rating} onClick={async () => { await rateCard(deck[index], rating); if (rating !== 'again') setCorrect(n => n + 1); if (index + 1 >= deck.length) { await saveSession('review', correct + Number(rating !== 'again'), deck.length); setIndex(deck.length); } else nextCard(); }}><strong>{['Quên rồi', 'Khó', 'Nhớ', 'Dễ'][i]}</strong><small>{['Gặp lại ngay', 'Gặp lại sớm', 'Gặp lại sau vài ngày', 'Lâu nữa mới gặp lại'][i]}</small></button>)}</div>
                : <p className="kbd-hint">Nghĩ xem từ này nghĩa là gì, rồi lật thẻ để xem mình nhớ đúng không.</p>}
            </>}</>}

            {view === 'match' && <>{matched.length === matchTerms.length ? <Result correct={matched.length} total={matched.length} onAgain={() => beginMode('match')} onBack={() => setView('set')} extra={`Thời gian: ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`} /> : <>
              <div className="between match-head"><p className="muted">Chọn một từ rồi chọn nghĩa tương ứng.</p><span className="timer"><Clock3 size={15} /> {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span></div>
              <div className="match-grid">
                <div>{matchTerms.map(c => <button key={c.id} className={`match-tile ${matched.includes(c.id) ? 'matched' : ''} ${matchSelection?.id === c.id && matchSelection.type === 'term' ? 'selected' : ''} ${wrongMatch && matchSelection?.id === c.id ? 'wrong' : ''}`} aria-pressed={matchSelection?.id === c.id && matchSelection.type === 'term'} disabled={matched.includes(c.id)} onClick={() => chooseMatch('term', c.id)}>{c.term}</button>)}</div>
                <div>{matchDefinitions.map(c => <button key={c.id} className={`match-tile def ${matched.includes(c.id) ? 'matched' : ''} ${matchSelection?.id === c.id && matchSelection.type === 'definition' ? 'selected' : ''} ${wrongMatch && matchSelection?.id === c.id ? 'wrong' : ''}`} aria-pressed={matchSelection?.id === c.id && matchSelection.type === 'definition'} disabled={matched.includes(c.id)} onClick={() => chooseMatch('definition', c.id)}>{c.definition}</button>)}</div>
              </div>
            </>}</>}

            {view === 'test' && <>
              {!testStarted ? <div className="panel test-setup">
                <span className="tone-icon blue"><GraduationCap size={20} /></span>
                <h2>Chuẩn bị bài kiểm tra</h2>
                <p className="muted">Chọn số câu và cách trả lời trước khi bắt đầu.</p>
                <div className="form-grid">
                  <label className="field"><span>Số câu hỏi (tối đa {deck.length})</span><input className="input" type="number" min="1" max={deck.length} value={testNumber} onChange={e => setTestNumber(Math.max(1, Math.min(deck.length, Number(e.target.value))))} /></label>
                  <div className="field"><span>Dạng câu hỏi</span><div className="segmented" role="radiogroup" aria-label="Dạng câu hỏi"><button role="radio" aria-checked={testType === 'typing'} className={testType === 'typing' ? 'on' : ''} onClick={() => setTestType('typing')}>Tự gõ đáp án</button><button role="radio" aria-checked={testType === 'multiple'} className={testType === 'multiple' ? 'on' : ''} onClick={() => setTestType('multiple')}>Chọn đáp án</button></div></div>
                </div>
                <button className="btn primary big" onClick={startTest}><Play /> Bắt đầu kiểm tra</button>
              </div> : testDone ? <div>
                <Result correct={correct} total={deck.length} onAgain={() => beginMode('test')} onBack={() => setView('set')} />
                <div className="panel review-answers"><h3>Xem lại đáp án</h3>{deck.map((c, i) => { const ok = normalizeAnswer(testAnswers[c.id] || '') === normalizeAnswer(c.definition); return <div key={c.id} className={`answer-review ${ok ? 'ok' : 'bad'}`}><span className="answer-mark" aria-label={ok ? 'Đúng' : 'Sai'}>{ok ? <Check size={14} /> : <X size={14} />}</span><div><strong>{i + 1}. {c.term}</strong><p>Bạn trả lời: {testAnswers[c.id] || <em>Bỏ trống</em>}</p>{!ok && <small>Đáp án: {c.definition}</small>}</div></div>; })}</div>
              </div> : <>
                <div className="between test-head"><h2>Bài kiểm tra</h2><span className="pill">{Object.values(testAnswers).filter(Boolean).length}/{deck.length} đã trả lời</span></div>
                {deck.map((c, i) => <div className="panel test-q" key={c.id}>
                  <div className="between"><span className="eyebrow">Từ</span><span className="muted small">{i + 1} / {deck.length}</span></div>
                  <h3>{c.term}</h3>
                  {testType === 'typing' ? <label className="field"><span>Nghĩa</span><input className="input" value={testAnswers[c.id] || ''} onChange={e => setTestAnswers(a => ({ ...a, [c.id]: e.target.value }))} placeholder="Nhập câu trả lời" /></label>
                    : <div className="answer-grid" role="radiogroup" aria-label={`Chọn nghĩa cho ${c.term}`}>{testChoices[c.id]?.map((choice, k) => <button key={choice} role="radio" aria-checked={testAnswers[c.id] === choice} className={`answer-option ${testAnswers[c.id] === choice ? 'selected' : ''}`} onClick={() => setTestAnswers(a => ({ ...a, [c.id]: choice }))}><span className="option-key">{k + 1}</span><span>{choice}</span></button>)}</div>}
                </div>)}
                <div className="center-row"><button className="btn primary big" onClick={finishTest}>Nộp bài <Check /></button></div>
              </>}
            </>}
          </>}
        </div>}

        {view === 'stats' && <>
          <div className="welcome"><h1>Thống kê học tập</h1><p>Tiến bộ được tạo nên từ từng buổi học.</p></div>
          <div className="stats-grid">
            <Stat icon={BookOpen} label="Tổng số thẻ" value={totalCards} caption="Trong thư viện" tone="violet" />
            <Stat icon={Check} label="Đã thuộc" value={mastered} caption="Từ đã nhớ chắc" tone="green" />
            <Stat icon={Flame} label="Buổi học" value={data.sessions.length} caption="Đã hoàn thành" tone="amber" />
            <Stat icon={Target} label="Tỉ lệ đúng" value={`${Math.round(data.sessions.reduce((n, s) => n + s.correct, 0) / Math.max(1, data.sessions.reduce((n, s) => n + s.total, 0)) * 100)}%`} caption="Qua các buổi học" tone="blue" />
          </div>
          <div className="two-col">
            <div className="panel"><h2>7 ngày gần đây</h2><p className="muted small">Lượt thẻ đã luyện tập mỗi ngày</p><ActivityChart days={activityByDay} height={230} /></div>
            <div className="panel"><h2>Lịch sử gần đây</h2>{data.sessions.length ? <ul className="history">{data.sessions.slice(0, 7).map(s => <li className="between" key={s.id}><div><strong>{modes.find(m => m.id === s.mode)?.name || s.mode}</strong><div className="muted small">{formatDate(s.created_at)} · {Math.ceil(s.duration_seconds / 60)} phút</div></div><span className="pill">{s.correct}/{s.total}</span></li>)}</ul> : <p className="muted">Chưa có buổi học nào. Học thử một bộ từ để xem tiến độ nhé.</p>}</div>
          </div>
        </>}

        {view === 'settings' && <>
          <div className="welcome"><h1>Cài đặt</h1><p>Điều chỉnh không gian học theo ý bạn.</p></div>
          <div className="panel settings-panel">
            <h2>Hồ sơ & mục tiêu</h2>
            <label className="field"><span>Tên hiển thị</span><input className="input" value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Tên của bạn" /></label>
            <div className="form-grid">
              <label className="field"><span>Ngôn ngữ đang học</span><select className="select" value={learningLanguage} onChange={e => setLearningLanguage(e.target.value)}><option>English</option><option>日本語</option><option>中文</option><option>한국어</option><option>Français</option></select></label>
              <label className="field"><span>Mục tiêu mỗi ngày (lượt học)</span><input className="input" type="number" min="1" max="1000" value={dailyGoal} onChange={e => setDailyGoal(Number(e.target.value))} /></label>
            </div>
            <button className="btn primary" onClick={saveProfile}><Save /> Lưu cài đặt</button>
            <hr />
            <div className="between"><div><strong>Giao diện tối</strong><p className="muted small" style={{ margin: 0 }}>Dễ chịu hơn khi học vào buổi tối</p></div><button className={`switch ${dark ? 'on' : ''}`} role="switch" aria-checked={dark} aria-label="Giao diện tối" onClick={() => setDark(v => !v)}><span /></button></div>
            {demo && <p className="muted small" style={{ marginTop: 24 }}>Dữ liệu demo chỉ lưu trên trình duyệt hiện tại. Đăng nhập để đồng bộ.</p>}
          </div>
        </>}
      </motion.div></AnimatePresence></div>
    </main>

    {!inStudy && <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <button className="brand" onClick={() => go('dashboard')}><span className="brand-mark"><Heart size={17} fill="currentColor" /></span>VanLet</button>
          <p className="muted small">Học từ vựng nhẹ nhàng mỗi ngày. Học ít, nhớ lâu.</p>
        </div>
        <div className="footer-goal">
          <div className="between"><strong><Target size={15} /> Mục tiêu hôm nay</strong><span>{goalPercent}%</span></div>
          <div className="tiny-progress" role="progressbar" aria-label="Tiến độ mục tiêu hôm nay" aria-valuenow={goalPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${goalPercent}%` }} /></div>
          <small className="muted">{todayReviewed}/{goal} từ · {todayMinutes} phút hôm nay</small>
        </div>
        <nav className="footer-links" aria-label="Liên kết phụ">
          <button onClick={() => go('discover')}><Globe2 size={15} /> Bộ từ công khai</button>
          <button onClick={() => go('stats')}><ChartNoAxesColumn size={15} /> Thống kê</button>
          <button onClick={() => go('settings')}><Settings2 size={15} /> Cài đặt</button>
          <button onClick={demo ? exitDemo : signOut}><LogOut size={15} /> {demo ? 'Thoát dùng thử' : 'Đăng xuất'}</button>
        </nav>
      </div>
      <div className="footer-bottom">© {new Date().getFullYear()} VanLet · Làm bằng <Heart size={12} fill="currentColor" /> cho người học</div>
    </footer>}

    {!inStudy && <nav className="mobile-nav" aria-label="Điều hướng">{[nav[0], nav[1], { id: 'editor' as View, name: 'Tạo', icon: Plus }, { ...nav[3], name: 'Ôn tập' }, nav[4]].map(item => <button key={item.id} className={`${view === item.id ? 'active' : ''} ${item.id === 'editor' ? 'create' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => item.id === 'editor' ? openEditor() : navTo(item.id)}><item.icon />{item.name}</button>)}</nav>}

    {modal && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setModal(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="between modal-header"><h2 id="modal-title">{modal === 'share' ? 'Mời học cùng' : editingFolder ? 'Đổi tên thư mục' : 'Tạo thư mục'}</h2><button className="icon-button" aria-label="Đóng" onClick={() => setModal(null)}><X size={18} /></button></div>
      {modal === 'share' ? <>
        <p className="muted">Mời bằng email. Người nhận đăng nhập bằng đúng email rồi mở liên kết để nhận quyền.</p>
        <label className="field"><span>Email người nhận</span><input className="input" type="email" autoComplete="off" value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="ban.be@email.com" /></label>
        <label className="field"><span>Quyền truy cập</span><select className="select" value={shareRole} onChange={e => setShareRole(e.target.value as typeof shareRole)}><option value="viewer">Chỉ xem và học</option><option value="editor">Chỉnh sửa thẻ</option></select></label>
        <button className="btn primary block" onClick={createShareInvite}><Plus /> Tạo liên kết mời</button>
        {shareLink && <div className="row" style={{ marginTop: 15 }}><input className="input" readOnly aria-label="Liên kết mời" value={shareLink} onFocus={e => e.target.select()} /><button className="btn" aria-label="Sao chép liên kết" onClick={async () => { try { await navigator.clipboard.writeText(shareLink); toast('Đã sao chép liên kết.'); } catch { toast('Không thể sao chép liên kết.'); } }}><Copy /></button></div>}
        <hr />
        <h3>Lời mời đã tạo</h3>
        {shareInvites.length ? <ul className="invite-list">{shareInvites.map(invite => <li key={invite.token} className="between"><div><strong>{invite.email}</strong><div className="muted small">{invite.role === 'editor' ? 'Chỉnh sửa' : 'Chỉ xem'} · {invite.accepted_at ? 'Đã nhận' : 'Chờ nhận'}</div></div><button className="icon-button" aria-label={`Thu hồi quyền của ${invite.email}`} title="Thu hồi" onClick={() => revokeShareInvite(invite)}><Trash2 size={15} /></button></li>)}</ul> : <p className="muted">Chưa có lời mời nào.</p>}
      </> : <form onSubmit={e => { e.preventDefault(); void saveFolder(); }}>
        <label className="field"><span>Tên thư mục</span><input className="input" autoFocus value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Ví dụ: Tiếng Nhật N3" /></label>
        <button className="btn primary block"><Save /> Lưu thư mục</button>
      </form>}
    </div></div>}
    {message && <div className="toast" role="status" aria-live="polite">{message}</div>}
  </div>;
}

function LearnPanel({ card, stage, options, choice, answer, feedback, mastered, total, attempts, onChoice, onAnswer, onSubmit, onSkip, onNext, onRestart, onBack }: { card: Card | undefined; stage: 'choice' | 'typing'; options: string[]; choice: string; answer: string; feedback: 'correct' | 'wrong' | null; mastered: number; total: number; attempts: number; onChoice: (value: string) => void; onAnswer: (value: string) => void; onSubmit: () => void; onSkip: () => void; onNext: () => void; onRestart: () => void; onBack: () => void }) {
  // Number keys pick an option and Enter continues, as in Quizlet Learn.
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement) return;
      if (feedback && e.key === 'Enter') { e.preventDefault(); onNext(); return; }
      const n = Number(e.key); if (!feedback && stage === 'choice' && n >= 1 && n <= options.length) onChoice(options[n - 1]);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [card, feedback, stage, options, onChoice, onNext]);
  if (!card) return <Result correct={mastered} total={total} onAgain={onRestart} onBack={onBack} />;
  const expected = card.definition;
  return <div className="learn-screen">
    <div className="panel learn-panel">
      <div className="learn-question"><div className="between"><span className="eyebrow">Từ</span><span className={`stage-pill ${stage}`}>{stage === 'choice' ? 'Bước 1 · Chọn đáp án' : 'Bước 2 · Tự gõ lại'}</span></div><div className="learn-word">{card.term}</div></div>
      <p className="learn-prompt">{stage === 'choice' ? 'Chọn nghĩa đúng' : 'Gõ nghĩa'}</p>
      {stage === 'choice' ? <div className="learn-options">{options.map((option, i) => { const isRight = feedback && normalizeAnswer(option) === normalizeAnswer(expected); const isWrong = feedback && !isRight && option === choice; return <button key={`${option}-${i}`} className={`answer-option ${isRight ? 'correct' : isWrong ? 'wrong' : ''}`} disabled={!!feedback} onClick={() => onChoice(option)}><span className="option-key">{isRight ? <Check size={14} /> : isWrong ? <X size={14} /> : i + 1}</span><span>{option}</span></button>; })}</div>
        : <div className="learn-input"><input className={`input big ${feedback || ''}`} autoFocus aria-label="Câu trả lời của bạn" value={answer} disabled={!!feedback} onChange={e => onAnswer(e.target.value)} onKeyDown={e => e.key === 'Enter' && (feedback ? onNext() : onSubmit())} placeholder="Nhập câu trả lời" /></div>}
      {feedback && <div className={`learn-feedback ${feedback}`} role="status">{feedback === 'correct' ? <Check size={18} /> : <X size={18} />}<div><strong>{feedback === 'correct' ? 'Chính xác! Làm tốt lắm.' : 'Chưa đúng – bạn sẽ gặp lại từ này.'}</strong>{feedback === 'wrong' && <span>Đáp án đúng: {expected}</span>}</div></div>}
      <div className="learn-actions">
        <span className="muted small">{feedback ? 'Nhấn Enter hoặc nút bên cạnh để tiếp tục' : stage === 'typing' ? 'Nhấn Enter để kiểm tra' : `Nhấn phím 1–${options.length} để chọn`}</span>
        {stage === 'typing' && !feedback && <button className="btn ghost" onClick={onSkip}>Không biết?</button>}
        {stage === 'typing' && !feedback && <button className="btn primary" disabled={!answer.trim()} onClick={onSubmit}>Trả lời</button>}
        {feedback && <button className="btn primary" onClick={onNext}>Tiếp tục <ArrowRight /></button>}
      </div>
    </div>
    <p className="muted small learn-meta">{mastered}/{total} từ đã thuộc · {attempts} lượt trả lời</p>
  </div>;
}

function FlipCard({ front, back, frontLabel, backLabel, frontHint, backHint, flipped, onFlip, compact }: { front?: string; back?: string; frontLabel: string; backLabel: string; frontHint?: string; backHint?: string; flipped: boolean; onFlip: () => void; compact?: boolean }) {
  return <div className={`flip ${flipped ? 'is-flipped' : ''} ${compact ? 'compact' : ''}`} role="button" tabIndex={0} aria-pressed={flipped} aria-label={flipped ? `${backLabel}: ${back}. Nhấn để lật lại` : `${frontLabel}: ${front}. Nhấn để lật thẻ`}
    onClick={onFlip} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onFlip(); } }}>
    <div className="flip-inner">
      <div className="flip-face front" aria-hidden={flipped}><span className="face-label">{frontLabel}</span><div className="word">{front}</div>{frontHint && <div className="phonetic">{frontHint}</div>}</div>
      <div className="flip-face back" aria-hidden={!flipped}><span className="face-label">{backLabel}</span><div className="word">{back}</div>{backHint && <p className="hint">{backHint}</p>}</div>
    </div>
  </div>;
}

function SetPreview({ cards, onExpand, onSpeak }: { cards: Card[]; onExpand: () => void; onSpeak: (text: string) => void }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[Math.min(i, cards.length - 1)];
  const go = (next: number) => { setI(next); setFlipped(false); };
  return <section className="set-preview" aria-label="Xem nhanh thẻ ghi nhớ">
    <FlipCard compact flipped={flipped} onFlip={() => setFlipped(v => !v)} frontLabel="Từ" backLabel="Nghĩa" front={card.term} back={card.definition} frontHint={card.phonetic} backHint={card.example} />
    <div className="preview-bar">
      <button className="icon-button plain" aria-label="Nghe phát âm" onClick={() => onSpeak(card.term)}><Volume2 size={18} /></button>
      <div className="row"><button className="icon-button round" aria-label="Thẻ trước" disabled={i === 0} onClick={() => go(i - 1)}><ChevronLeft /></button><span className="fc-count">{i + 1} / {cards.length}</span><button className="icon-button round" aria-label="Thẻ tiếp" disabled={i >= cards.length - 1} onClick={() => go(i + 1)}><ChevronRight /></button></div>
      <button className="icon-button plain" aria-label="Mở to để học" title="Mở to để học" onClick={onExpand}><Maximize2 size={17} /></button>
    </div>
  </section>;
}

function Stat({ icon: Icon, label, value, caption, tone }: { icon: typeof BookOpen; label: string; value: number | string; caption: string; tone: Tone }) { return <div className={`stat-card ${tone}`}><div className="stat-top"><span>{label}</span><span className={`tone-icon sm ${tone}`}><Icon size={16} /></span></div><div className="stat-number">{value}</div><div className="stat-caption">{caption}</div></div>; }
function SetCard({ set, onClick }: { set: SetRecord; onClick: () => void }) { return <button className="set-card" onClick={onClick}><div className={`set-art ${set.cover_color || 'violet'}`}><BookOpen /></div><h3>{set.title}</h3><p>{set.description || `${set.source_language} → ${set.target_language}`}</p><div className="set-meta"><span className="pill">{set.card_count || 0} thẻ</span><span>{set.visibility === 'public' ? 'Công khai' : 'Riêng tư'}</span></div></button>; }
function Empty({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) { return <div className="empty"><span className="tone-icon violet"><BookOpen size={22} /></span><h3>{title}</h3><p>{text}</p><Button onClick={onClick}>{action} <ArrowRight /></Button></div>; }
function Result({ correct, total, onAgain, onBack, extra }: { correct: number; total: number; onAgain: () => void; onBack: () => void; extra?: string }) { const pct = Math.round(correct / Math.max(1, total) * 100); return <div className="panel result"><span className="tone-icon green big"><Trophy size={26} /></span><h1>{pct >= 80 ? 'Xuất sắc!' : pct >= 50 ? 'Làm tốt lắm!' : 'Tiếp tục cố gắng nhé!'}</h1><p className="muted">Bạn đã hoàn thành lượt học này.</p><div className="result-score"><strong>{correct}/{total}</strong><span>đúng · {pct}%</span></div>{extra && <p className="muted small">{extra}</p>}<div className="study-controls"><button className="btn" onClick={onBack}>Quay lại bộ từ</button><button className="btn primary" onClick={onAgain}><RotateCcw /> Học lại</button></div></div>; }
function DiscoverPanel({ searchBox, sets, total, onOpen, onMore, onCreate }: { searchBox: React.ReactNode; sets: SetRecord[]; total: number; onOpen: (id: string) => void; onMore: () => void; onCreate: () => void }) { return <><div className="welcome"><h1>Khám phá bộ từ</h1><p>{total} bộ từ được chia sẻ công khai bởi mọi người.</p></div>{searchBox}{sets.length ? <div className="set-grid">{sets.map(s => <SetCard key={s.id} set={s} onClick={() => onOpen(s.id)} />)}</div> : <Empty title="Chưa có bộ từ công khai" text="Hãy tạo bộ từ và chọn “Mọi người” ở quyền xem để chia sẻ." action="Tạo bộ từ" onClick={onCreate} />}{sets.length < total && <div className="center-row"><button className="btn" onClick={onMore}>Tải thêm <ChevronRight /></button></div>}</>; }
function ActivityChart({ days, height }: { days: { label: string; value: number }[]; height: number }) { return <div style={{ width: '100%', height, marginTop: 12 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={days} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} /><Tooltip cursor={{ fill: 'var(--soft)' }} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }} formatter={(value) => [`${value} từ`, 'Đã học']} /><Bar dataKey="value" fill="var(--chart)" radius={[8, 8, 3, 3]} maxBarSize={34} /></BarChart></ResponsiveContainer></div>; }
function FolderBar({ folders, selected, onSelect, onAdd, onEdit, onDelete }: { folders: Folder[]; selected: string; onSelect: (id: string) => void; onAdd: () => void; onEdit: (folder: Folder) => void; onDelete: (folder: Folder) => void }) {
  const current = folders.find(f => f.id === selected);
  return <div className="folder-bar">
    <div className="chips" role="tablist" aria-label="Thư mục">
      <button role="tab" aria-selected={selected === 'all'} className={`chip ${selected === 'all' ? 'on' : ''}`} onClick={() => onSelect('all')}>Tất cả</button>
      {folders.map(folder => <button role="tab" aria-selected={selected === folder.id} key={folder.id} className={`chip ${selected === folder.id ? 'on' : ''}`} onClick={() => onSelect(folder.id)}><FolderOpen size={14} /> {folder.name}</button>)}
      <button className="chip add" onClick={onAdd}><Plus size={14} /> Thư mục</button>
    </div>
    {current && <div className="row"><button className="btn ghost small" onClick={() => onEdit(current)}><Pencil /> Đổi tên</button><button className="btn ghost small danger" onClick={() => onDelete(current)}><Trash2 /> Xóa thư mục</button></div>}
  </div>;
}
function SharedPanel({ sets, total, onOpen, onMore }: { sets: SetRecord[]; total: number; onOpen: (id: string) => void; onMore: () => void }) { return <><div className="welcome"><h1>Được chia sẻ với bạn</h1><p>{total} bộ từ mà bạn bè hoặc giáo viên đã mời bạn cùng học.</p></div>{sets.length ? <div className="set-grid">{sets.map(s => <SetCard key={s.id} set={s} onClick={() => onOpen(s.id)} />)}</div> : <div className="empty"><span className="tone-icon violet"><Users size={22} /></span><h3>Chưa có bộ từ được chia sẻ</h3><p>Khi bạn nhận lời mời qua liên kết, bộ từ sẽ xuất hiện ở đây.</p></div>}{sets.length < total && <div className="center-row"><button className="btn" onClick={onMore}>Tải thêm <ChevronRight /></button></div>}</>; }
