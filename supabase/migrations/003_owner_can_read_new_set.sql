-- `insert ... returning` on study_sets failed with "new row violates row-level security policy":
-- the select policy only called can_view_set(id), a STABLE function that cannot see the row
-- being inserted by the same statement. Checking owner_id on the row itself fixes that.
drop policy if exists sets_select on public.study_sets;
create policy sets_select on public.study_sets for select to authenticated
  using (owner_id = auth.uid() or public.can_view_set(id));
