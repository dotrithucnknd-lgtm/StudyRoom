import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorized, failure } from '@/lib/server';
const shape = z.object({ name: z.string().trim().min(1).max(120) });
export async function GET(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const { data, error } = await auth.db.from('folders').select('*').eq('owner_id', auth.userId).order('name');
  return error ? failure(error) : NextResponse.json(data);
}
export async function POST(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const parsed = shape.safeParse(await request.json()); if (!parsed.success) return failure(new Error('Tên thư mục không hợp lệ.'));
  const { data, error } = await auth.db.from('folders').insert({ name: parsed.data.name, owner_id: auth.userId }).select().single();
  return error ? failure(error) : NextResponse.json(data, { status: 201 });
}
export async function PATCH(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const body = await request.json(); const id = z.string().uuid().safeParse(body.id); const parsed = shape.safeParse(body);
  if (!id.success || !parsed.success) return failure(new Error('Dữ liệu không hợp lệ.'));
  const { data, error } = await auth.db.from('folders').update(parsed.data).eq('id', id.data).eq('owner_id', auth.userId).select().single();
  return error ? failure(error) : NextResponse.json(data);
}
export async function DELETE(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id'); if (!z.string().uuid().safeParse(id).success) return failure(new Error('ID không hợp lệ.'));
  const { error } = await auth.db.from('folders').delete().eq('id', id).eq('owner_id', auth.userId);
  return error ? failure(error) : NextResponse.json({ ok: true });
}
