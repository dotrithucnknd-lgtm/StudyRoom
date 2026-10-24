import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
export async function authorized(request: NextRequest): Promise<{ db: SupabaseClient; userId: string } | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Hệ thống đăng nhập chưa sẵn sàng. Vui lòng thử lại sau.' }, { status: 503 });
  const token = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!token) return NextResponse.json({ error: 'Cần đăng nhập.' }, { status: 401 });
  const db = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: 'Bạn đã bị đăng xuất. Vui lòng đăng nhập lại.' }, { status: 401 });
  return { db, userId: data.user.id };
}
/** Database errors from Supabase are plain objects (not Error), so read their message too instead of hiding it. */
export function failure(error: unknown, status = 400) {
  const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown } | null;
  const message = e && typeof e.message === 'string' && e.message ? e.message : 'Có lỗi xảy ra.';
  if (!(error instanceof Error)) console.error('[api]', error);
  return NextResponse.json({ error: message, code: typeof e?.code === 'string' ? e.code : undefined }, { status });
}
