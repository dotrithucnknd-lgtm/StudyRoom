import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorized, failure } from '@/lib/server';
const shape = z.object({ title: z.string().trim().min(1).max(160), description: z.string().max(2000).default(''), source_language: z.string().max(60).default('English'), target_language: z.string().max(60).default('Tiếng Việt'), visibility: z.enum(['private', 'public']).default('private'), tags: z.array(z.string().max(40)).default([]), cover_color: z.string().max(30).default('violet'), folder_id: z.string().uuid().nullable().default(null) });
export async function GET(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const page = Math.max(0, Math.min(10000, Math.trunc(Number(request.nextUrl.searchParams.get('page') || 0) || 0)));
  const query = request.nextUrl.searchParams.get('q')?.slice(0, 100) || '';
  const id = request.nextUrl.searchParams.get('id');
  const scope = request.nextUrl.searchParams.get('scope');
  let sharedTotal: number | null = null;
  let sharedIds: string[] = [];
  if (!id && scope === 'shared') {
    const links = await auth.db.from('set_shares').select('set_id', { count: 'exact' }).eq('user_id', auth.userId).order('set_id').range(page * 24, page * 24 + 23);
    if (links.error) return failure(links.error);
    sharedTotal = links.count || 0; sharedIds = (links.data || []).map(link => link.set_id);
    if (!sharedIds.length) return NextResponse.json({ sets: [], total: sharedTotal });
  }
  const offset = scope === 'shared' && !id ? 0 : page * 24;
  let q = auth.db.from('study_sets').select('*, flashcards(count)', { count: 'exact' }).order('updated_at', { ascending: false }).range(offset, offset + 23);
  if (id) { if (!z.string().uuid().safeParse(id).success) return failure(new Error('ID không hợp lệ.')); q = q.eq('id', id); }
  else if (scope === 'shared') q = q.in('id', sharedIds);
  else if (scope === 'public') q = q.eq('visibility', 'public');
  else q = q.eq('owner_id', auth.userId);
  if (query) q = q.ilike('title', `%${query.replace(/[%_]/g, '')}%`);
  const { data, error, count } = await q;
  if (error) return failure(error);
  const ids = (data || []).map(s => s.id);
  const links = ids.length ? await auth.db.from('set_shares').select('set_id,role').eq('user_id', auth.userId).in('set_id', ids) : { data: [], error: null };
  if (links.error) return failure(links.error);
  const roles = new Map((links.data || []).map(link => [link.set_id, link.role]));
  return NextResponse.json({ sets: (data || []).map(s => ({ ...s, card_count: s.flashcards?.[0]?.count || 0, access_role: s.owner_id === auth.userId ? 'owner' : (roles.get(s.id) || 'viewer') })), total: sharedTotal ?? count });
}
export async function POST(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const parsed = shape.safeParse(await request.json()); if (!parsed.success) return failure(new Error('Thông tin bộ từ chưa hợp lệ.'));
  const { data, error } = await auth.db.from('study_sets').insert({ ...parsed.data, owner_id: auth.userId }).select().single();
  return error ? failure(error) : NextResponse.json(data, { status: 201 });
}
export async function PATCH(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const body = await request.json(); const id = z.string().uuid().safeParse(body.id); const parsed = shape.partial().safeParse(body);
  if (!id.success || !parsed.success) return failure(new Error('Thông tin không hợp lệ.'));
  const { data, error } = await auth.db.from('study_sets').update(parsed.data).eq('id', id.data).eq('owner_id', auth.userId).select().single();
  return error ? failure(error) : NextResponse.json(data);
}
export async function DELETE(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id'); if (!z.string().uuid().safeParse(id).success) return failure(new Error('ID không hợp lệ.'));
  const { error } = await auth.db.from('study_sets').delete().eq('id', id).eq('owner_id', auth.userId);
  return error ? failure(error) : NextResponse.json({ ok: true });
}
