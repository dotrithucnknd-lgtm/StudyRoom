import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorized, failure } from '@/lib/server';
import { scheduleReview } from '@/lib/study';
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('review'), card_id: z.string().uuid(), rating: z.enum(['again', 'hard', 'good', 'easy']) }),
  z.object({ kind: z.literal('session'), set_id: z.string().uuid(), mode: z.enum(['flashcards', 'learn', 'match', 'test', 'review']), correct: z.number().int().nonnegative(), total: z.number().int().nonnegative(), duration_seconds: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('profile'), display_name: z.string().trim().min(1).max(80), learning_language: z.string().max(60), daily_goal: z.number().int().min(1).max(1000) })
]);
export async function POST(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return failure(new Error('Dữ liệu không hợp lệ.'));
  const body = parsed.data;
  if (body.kind === 'review') {
    const { data: previous } = await auth.db.from('card_progress').select('*').eq('card_id', body.card_id).eq('user_id', auth.userId).maybeSingle();
    const next = scheduleReview(previous || undefined, body.rating);
    const { error } = await auth.db.from('card_progress').upsert({ ...next, user_id: auth.userId, card_id: body.card_id });
    if (error) return failure(error);
    const { error: logError } = await auth.db.from('review_logs').insert({ user_id: auth.userId, card_id: body.card_id, rating: body.rating, interval_days: next.interval_days });
    return logError ? failure(logError) : NextResponse.json(next);
  }
  if (body.kind === 'session') {
    const { data, error } = await auth.db.from('study_sessions').insert({ ...body, kind: undefined, user_id: auth.userId }).select().single();
    return error ? failure(error) : NextResponse.json(data);
  }
  const { data, error } = await auth.db.from('profiles').upsert({ ...body, kind: undefined, id: auth.userId }).select().single();
  return error ? failure(error) : NextResponse.json(data);
}
export async function GET(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const [profile, sessions, cards, mastered, due] = await Promise.all([
    auth.db.from('profiles').select('*').eq('id', auth.userId).maybeSingle(),
    auth.db.from('study_sessions').select('*').eq('user_id', auth.userId).order('created_at', { ascending: false }).limit(200),
    auth.db.from('flashcards').select('id,study_sets!inner(owner_id)', { count: 'exact', head: true }).eq('study_sets.owner_id', auth.userId),
    auth.db.from('card_progress').select('card_id', { count: 'exact', head: true }).eq('user_id', auth.userId).eq('state', 'mastered'),
    auth.db.from('card_progress').select('card_id', { count: 'exact', head: true }).eq('user_id', auth.userId).lte('due_at', new Date().toISOString()).neq('state', 'mastered')
  ]);
  if (profile.error || sessions.error || cards.error || mastered.error || due.error) return failure(profile.error || sessions.error || cards.error || mastered.error || due.error);
  return NextResponse.json({ profile: profile.data, sessions: sessions.data, overview: { cards: cards.count || 0, mastered: mastered.count || 0, due: due.count || 0 } });
}
