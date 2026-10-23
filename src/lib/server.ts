import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
export async function authorized(request: NextRequest): Promise<{ db: SupabaseClient; userId: string } | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Supabase chưa được cấu hình.' }, { status: 503 });
  const token = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!token) return NextResponse.json({ error: 'Cần đăng nhập.' }, { status: 401 });
  const db = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: 'Phiên đăng nhập không hợp lệ.' }, { status: 401 });
  return { db, userId: data.user.id };
}
export function failure(error: unknown, status = 400) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Có lỗi xảy ra.' }, { status }); }
