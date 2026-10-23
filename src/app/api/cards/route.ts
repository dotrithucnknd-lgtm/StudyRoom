import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorized, failure } from '@/lib/server';
const shape = z.object({ set_id: z.string().uuid(), term: z.string().trim().min(1).max(300), definition: z.string().trim().min(1).max(3000), phonetic: z.string().max(300).default(''), example: z.string().max(3000).default(''), example_translation: z.string().max(3000).default(''), notes: z.string().max(3000).default(''), synonyms: z.string().max(500).default(''), antonyms: z.string().max(500).default(''), tags: z.array(z.string().max(40)).default([]), favorite: z.boolean().default(false), difficult: z.boolean().default(false), mastered: z.boolean().default(false), position: z.number().int().nonnegative().default(0) });
export async function GET(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('set'); if (!z.string().uuid().safeParse(id).success) return failure(new Error('ID không hợp lệ.'));
  const page = Math.max(0, Math.min(10000, Math.trunc(Number(request.nextUrl.searchParams.get('page') || 0) || 0)));
  const { data, error, count } = await auth.db.from('flashcards').select('*, card_progress(*)', { count: 'exact' }).eq('set_id', id).order('position').range(page * 100, page * 100 + 99);
  return error ? failure(error) : NextResponse.json({ cards: (data || []).map(c => ({ ...c, progress: c.card_progress?.find((p: { user_id: string }) => p.user_id === auth.userId) })), total: count });
}
export async function POST(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const body = await request.json(); const batch = Array.isArray(body) ? body : [body];
  if (!batch.length || batch.length > 500) return failure(new Error('Mỗi lần thêm tối đa 500 thẻ.'));
  const parsed = z.array(shape).safeParse(batch); if (!parsed.success) return failure(new Error('Dữ liệu thẻ không hợp lệ.'));
  const setIds = [...new Set(parsed.data.map(c => c.set_id))]; if (setIds.length !== 1) return failure(new Error('Một lần chỉ thêm vào một bộ từ.'));
  const { data: owned } = await auth.db.from('study_sets').select('id').eq('id', setIds[0]).eq('owner_id', auth.userId).single();
  if (!owned) { const { data: shared } = await auth.db.from('set_shares').select('role').eq('set_id', setIds[0]).eq('user_id', auth.userId).eq('role', 'editor').maybeSingle(); if (!shared) return failure(new Error('Bạn không có quyền sửa bộ từ này.'), 403); }
  const { data, error } = await auth.db.from('flashcards').insert(parsed.data).select();
  return error ? failure(error) : NextResponse.json(data, { status: 201 });
}
export async function PATCH(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const body = await request.json(); const id = z.string().uuid().safeParse(body.id); const parsed = shape.omit({ set_id: true }).partial().safeParse(body);
  if (!id.success || !parsed.success) return failure(new Error('Dữ liệu không hợp lệ.'));
  const { data, error } = await auth.db.from('flashcards').update(parsed.data).eq('id', id.data).select().single();
  return error ? failure(error) : NextResponse.json(data);
}
export async function DELETE(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id'); if (!z.string().uuid().safeParse(id).success) return failure(new Error('ID không hợp lệ.'));
  const { error } = await auth.db.from('flashcards').delete().eq('id', id);
  return error ? failure(error) : NextResponse.json({ ok: true });
}
