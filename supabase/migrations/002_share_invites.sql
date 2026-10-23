create table public.share_invites (
  token uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.study_sets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (email=lower(email) and char_length(email) between 3 and 320),
  role text not null check (role in ('editor','viewer')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(set_id,email)
);
create index on public.share_invites(owner_id,created_at desc);
create index on public.share_invites(email,expires_at);
alter table public.share_invites enable row level security;
create policy invites_select on public.share_invites for select to authenticated using (owner_id=auth.uid() or email=lower(auth.jwt()->>'email'));
create policy invites_insert on public.share_invites for insert to authenticated with check (owner_id=auth.uid() and public.owns_set(set_id));
create policy invites_update on public.share_invites for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid() and public.owns_set(set_id));
create policy invites_delete on public.share_invites for delete to authenticated using (owner_id=auth.uid());

create function public.accept_share_invite(invite_token uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare invite public.share_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into invite from public.share_invites where token=invite_token for update;
  if not found or invite.expires_at <= now() or invite.email <> lower(auth.jwt()->>'email') then
    raise exception 'Invitation is invalid, expired, or belongs to a different email';
  end if;
  if invite.owner_id=auth.uid() then raise exception 'Owner cannot accept their own invitation'; end if;
  insert into public.set_shares(set_id,user_id,role) values(invite.set_id,auth.uid(),invite.role)
  on conflict(set_id,user_id) do update set role=excluded.role;
  update public.share_invites set accepted_user_id=auth.uid(),accepted_at=now() where token=invite_token;
  return invite.set_id;
end $$;
revoke all on function public.accept_share_invite(uuid) from public;
grant execute on function public.accept_share_invite(uuid) to authenticated;
