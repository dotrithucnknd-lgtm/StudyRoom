import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorized, failure } from '@/lib/server';
const create = z.object({ set_id: z.string().uuid(), email: z.email().max(320), role: z.enum(['viewer', 'editor']) });
export async function GET(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const setId = request.nextUrl.searchParams.get('set');
  if (!z.string().uuid().safeParse(setId).success) return failure(new Error('ID không hợp lệ.'));
  const { data: owned } = await auth.db.from('study_sets').select('id').eq('id', setId).eq('owner_id', auth.userId).maybeSingle();
  if (!owned) return failure(new Error('Chỉ chủ sở hữu được xem lời mời.'), 403);
  const { data, error } = await auth.db.from('share_invites').select('token,email,role,accepted_user_id,accepted_at,expires_at,created_at').eq('set_id', setId).order('created_at', { ascending: false });
  return error ? failure(error) : NextResponse.json(data);
}
export async function POST(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const parsed = create.safeParse(await request.json()); if (!parsed.success) return failure(new Error('Email hoặc quyền truy cập không hợp lệ.'));
  const { data: owned } = await auth.db.from('study_sets').select('id').eq('id', parsed.data.set_id).eq('owner_id', auth.userId).maybeSingle();
  if (!owned) return failure(new Error('Chỉ chủ sở hữu được mời người khác.'), 403);
  const { data: me } = await auth.db.auth.getUser(request.headers.get('authorization')!.replace(/^Bearer /i, ''));
  if (dataSafeEmail(me.user?.email) === dataSafeEmail(parsed.data.email)) return failure(new Error('Không thể mời chính bạn.'));
  const { data, error } = await auth.db.from('share_invites').upsert({ ...parsed.data, owner_id: auth.userId, email: dataSafeEmail(parsed.data.email), expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }, { onConflict: 'set_id,email' }).select().single();
  if (error) return failure(error);
  if (data.accepted_user_id) { const { error: roleError } = await auth.db.from('set_shares').update({ role: parsed.data.role }).eq('set_id', parsed.data.set_id).eq('user_id', data.accepted_user_id); if (roleError) return failure(roleError); }
  return NextResponse.json(data, { status: 201 });
}
export async function PATCH(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const token = z.string().uuid().safeParse((await request.json()).token); if (!token.success) return failure(new Error('Lời mời không hợp lệ.'));
  const { data, error } = await auth.db.rpc('accept_share_invite', { invite_token: token.data });
  return error ? failure(new Error('Lời mời đã hết hạn hoặc không dành cho email tài khoản này.'), 403) : NextResponse.json({ set_id: data });
}
export async function DELETE(request: NextRequest) {
  const auth = await authorized(request); if (auth instanceof NextResponse) return auth;
  const token = request.nextUrl.searchParams.get('token'); if (!z.string().uuid().safeParse(token).success) return failure(new Error('ID không hợp lệ.'));
  const { data: invite, error: lookupError } = await auth.db.from('share_invites').select('set_id,accepted_user_id').eq('token', token).eq('owner_id', auth.userId).maybeSingle();
  if (lookupError || !invite) return failure(new Error('Không tìm thấy lời mời.'), 404);
  if (invite.accepted_user_id) { const { error: revokeError } = await auth.db.from('set_shares').delete().eq('set_id', invite.set_id).eq('user_id', invite.accepted_user_id); if (revokeError) return failure(revokeError); }
  const { error } = await auth.db.from('share_invites').delete().eq('token', token).eq('owner_id', auth.userId);
  return error ? failure(error) : NextResponse.json({ ok: true });
}
function dataSafeEmail(email?: string | null) { return (email || '').trim().toLowerCase(); }
