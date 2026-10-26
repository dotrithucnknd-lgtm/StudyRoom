import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorized, failure } from '@/lib/server';
import { CARD_LIMITS, FIELD_LABELS, type LimitedField } from '@/lib/limits';
const shape = z.object({ set_id: z.string().uuid(), term: z.string().trim().min(1).max(CARD_LIMITS.term), definition: z.string().trim().min(1).max(CARD_LIMITS.definition), phonetic: z.string().max(CARD_LIMITS.phonetic).default(''), example: z.string().max(CARD_LIMITS.example).default(''), example_translation: z.string().max(CARD_LIMITS.example_translation).default(''), notes: z.string().max(CARD_LIMITS.notes).default(''), synonyms: z.string().max(CARD_LIMITS.synonyms).default(''), antonyms: z.string().max(CARD_LIMITS.antonyms).default(''), tags: z.array(z.string().max(40)).default([]), favorite: z.boolean().default(false), difficult: z.boolean().default(false), mastered: z.boolean().default(false), position: z.number().int().nonnegative().default(0) });
const patchShape = shape.omit({ set_id: true }).partial().extend({ id: z.string().uuid() });
const MAX_BATCH = 500;

/** Turn a zod error on a card batch into a message naming the card and field, e.g. "Thẻ số 312: Nghĩa quá dài". */
function cardError(error: z.ZodError, batch: unknown[]) {
  const issue = error.issues[0];
  const [index, field] = issue.path as [number, string];
  const row = batch[index] as { position?: number } | undefined;
  const number = typeof row?.position === 'number' ? row.position + 1 : index + 1;
  const label = FIELD_LABELS[field as LimitedField] || field;
  const limit = CARD_LIMITS[field as LimitedField];
  const reason = issue.code === 'too_big' && limit ? `quá dài (tối đa ${limit} ký tự)` : issue.code === 'too_small' ? 'đang để trống' : 'không hợp lệ';
  return new Error(`Thẻ số ${number}: ${label} ${reason}.`);
}

export async function GET(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('set'); if (!z.string().uuid().safeParse(id).success) return failure(new Error('ID không hợp lệ.'));
  const page = Math.max(0, Math.min(10000, Math.trunc(Number(request.nextUrl.searchParams.get('page') || 0) || 0)));
  // Study modes load a whole set at once; 1000 is Supabase's default row cap per request.
  const size = Math.max(1, Math.min(1000, Math.trunc(Number(request.nextUrl.searchParams.get('size') || 100) || 100)));
  const { data, error, count } = await auth.db.from('flashcards').select('*, card_progress(*)', { count: 'exact' }).eq('set_id', id).order('position').range(page * size, page * size + size - 1);
  return error ? failure(error) : NextResponse.json({ cards: (data || []).map(c => ({ ...c, progress: c.card_progress?.find((p: { user_id: string }) => p.user_id === auth.userId) })), total: count });
}
export async function POST(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const body = await request.json(); const batch = Array.isArray(body) ? body : [body];
  if (!batch.length || batch.length > MAX_BATCH) return failure(new Error(`Mỗi lần thêm tối đa ${MAX_BATCH} thẻ.`));
  const parsed = z.array(shape).safeParse(batch); if (!parsed.success) return failure(cardError(parsed.error, batch));
  const setIds = [...new Set(parsed.data.map(c => c.set_id))]; if (setIds.length !== 1) return failure(new Error('Một lần chỉ thêm vào một bộ từ.'));
  const { data: owned } = await auth.db.from('study_sets').select('id').eq('id', setIds[0]).eq('owner_id', auth.userId).single();
  if (!owned) { const { data: shared } = await auth.db.from('set_shares').select('role').eq('set_id', setIds[0]).eq('user_id', auth.userId).eq('role', 'editor').maybeSingle(); if (!shared) return failure(new Error('Bạn không có quyền sửa bộ từ này.'), 403); }
  const { data, error } = await auth.db.from('flashcards').insert(parsed.data).select();
  return error ? failure(error) : NextResponse.json(data, { status: 201 });
}
/** Update one card (object body) or many cards at once (array body), so big edits need one auth check instead of hundreds. */
export async function PATCH(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const body = await request.json();
  if (Array.isArray(body)) {
    if (!body.length || body.length > MAX_BATCH) return failure(new Error(`Mỗi lần sửa tối đa ${MAX_BATCH} thẻ.`));
    const parsed = z.array(patchShape).safeParse(body); if (!parsed.success) return failure(cardError(parsed.error, body));
    const rows = parsed.data; const results: unknown[] = new Array(rows.length); let next = 0; let failed: unknown = null;
    await Promise.all(Array.from({ length: Math.min(10, rows.length) }, async () => {
      while (next < rows.length && !failed) {
        const k = next++; const { id, ...fields } = rows[k];
        const { data, error } = await auth.db.from('flashcards').update(fields).eq('id', id).select().single();
        if (error) failed = error; else results[k] = data;
      }
    }));
    return failed ? failure(failed) : NextResponse.json(results);
  }
  const parsed = patchShape.safeParse(body);
  if (!parsed.success) return failure(new Error('Dữ liệu không hợp lệ.'));
  const { id, ...fields } = parsed.data;
  const { data, error } = await auth.db.from('flashcards').update(fields).eq('id', id).select().single();
  return error ? failure(error) : NextResponse.json(data);
}
/** Delete one card (?id=) or many cards (JSON body { ids }). */
export async function DELETE(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const single = request.nextUrl.searchParams.get('id');
  let ids: string[];
  if (single) ids = [single];
  else { const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH) }).safeParse(await request.json().catch(() => null)); if (!parsed.success) return failure(new Error('ID không hợp lệ.')); ids = parsed.data.ids; }
  if (!z.array(z.string().uuid()).safeParse(ids).success) return failure(new Error('ID không hợp lệ.'));
  const { error } = await auth.db.from('flashcards').delete().in('id', ids);
  return error ? failure(error) : NextResponse.json({ ok: true });
}
