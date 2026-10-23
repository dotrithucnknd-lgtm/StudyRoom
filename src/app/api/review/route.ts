import { NextRequest, NextResponse } from 'next/server';
import { authorized, failure } from '@/lib/server';
export async function GET(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const page = Math.max(0, Math.min(10000, Math.trunc(Number(request.nextUrl.searchParams.get('page') || 0) || 0)));
  const { data, error, count } = await auth.db.from('card_progress').select('*, flashcards(*)', { count: 'exact' }).eq('user_id', auth.userId).lte('due_at', new Date().toISOString()).neq('state', 'mastered').order('due_at').order('card_id').range(page * 100, page * 100 + 99);
  if (error) return failure(error);
  return NextResponse.json({ cards: (data || []).filter(p => p.flashcards).map(p => ({ ...p.flashcards, progress: p })), total: count || 0 });
}
