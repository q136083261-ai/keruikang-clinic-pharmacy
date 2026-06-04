-- Keruikang clinic pharmacy
-- Migration 03: database inventory transactions, RLS hardening, and RPC entry points.
-- Run this once in Supabase SQL Editor after migration 01/02.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists permissions text[] default array[]::text[];

alter table public.inventory_batches
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists production_date date,
  add column if not exists created_at timestamptz default now(),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz default now();

update public.inventory_batches
set id = gen_random_uuid()
where id is null;

create unique index if not exists inventory_batches_id_idx
  on public.inventory_batches(id);

create unique index if not exists inventory_batches_identity_idx
  on public.inventory_batches(medicine_id, batch_number, expiry_date);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  batch_id uuid references public.inventory_batches(id) on delete set null,
  batch_number text not null,
  movement_type text not null check (movement_type in ('in','out','dispose','count')),
  quantity integer not null,
  balance integer not null default 0,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.inventory_movements
  add column if not exists batch_id uuid references public.inventory_batches(id) on delete set null,
  add column if not exists batch_number text,
  add column if not exists movement_type text,
  add column if not exists quantity integer,
  add column if not exists balance integer default 0,
  add column if not exists note text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists created_at timestamptz default now();

create index if not exists inventory_movements_medicine_created_idx
  on public.inventory_movements(medicine_id, created_at desc);

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid() and active is true),
    'viewer'
  );
$$;

create or replace function public.has_clinic_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active is true
      and (
        role = 'admin'
        or permission_name = any(coalesce(permissions, array[]::text[]))
        or (role = 'operator' and permission_name = any(array[
          'medicine.create','medicine.edit','stock.in','stock.out',
          'inventory.count','disposal.create','alerts.view','transactions.view',
          'purchase.manage','public.manage'
        ]))
      )
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_batches_touch_updated_at on public.inventory_batches;
create trigger inventory_batches_touch_updated_at
before update on public.inventory_batches
for each row execute function public.touch_updated_at();

create or replace function public.rpc_stock_in(
  p_medicine_id uuid,
  p_batch_number text,
  p_quantity integer,
  p_production_date date,
  p_expiry_date date,
  p_unit text default null,
  p_location text default null,
  p_note text default null
)
returns table(batch_id uuid, batch_number text, quantity integer, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_batch public.inventory_batches%rowtype;
begin
  if not public.has_clinic_permission('stock.in') then
    raise exception 'permission denied: stock.in';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than zero';
  end if;
  if p_expiry_date is null or p_production_date is null or p_expiry_date <= p_production_date then
    raise exception 'expiry date must be later than production date';
  end if;

  insert into public.inventory_batches (
    medicine_id, batch_number, production_date, expiry_date,
    quantity, unit, location, created_by
  )
  values (
    p_medicine_id, trim(p_batch_number), p_production_date, p_expiry_date,
    p_quantity, nullif(trim(coalesce(p_unit, '')), ''), nullif(trim(coalesce(p_location, '')), ''), auth.uid()
  )
  on conflict (medicine_id, batch_number, expiry_date)
  do update set
    quantity = public.inventory_batches.quantity + excluded.quantity,
    production_date = excluded.production_date,
    unit = coalesce(excluded.unit, public.inventory_batches.unit),
    location = coalesce(excluded.location, public.inventory_batches.location),
    updated_at = now()
  returning * into target_batch;

  insert into public.inventory_movements (
    medicine_id, batch_id, batch_number, movement_type,
    quantity, balance, note, created_by
  )
  values (
    p_medicine_id, target_batch.id, target_batch.batch_number, 'in',
    p_quantity, target_batch.quantity, p_note, auth.uid()
  );

  return query select target_batch.id, target_batch.batch_number, p_quantity, target_batch.quantity;
end;
$$;

create or replace function public.rpc_stock_out(
  p_medicine_id uuid,
  p_quantity integer,
  p_note text default null
)
returns table(batch_id uuid, batch_number text, quantity integer, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer := p_quantity;
  take_qty integer;
  batch_row public.inventory_batches%rowtype;
  available_qty integer;
begin
  if not public.has_clinic_permission('stock.out') then
    raise exception 'permission denied: stock.out';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than zero';
  end if;

  select coalesce(sum(quantity), 0) into available_qty
  from public.inventory_batches
  where medicine_id = p_medicine_id and quantity > 0;

  if available_qty < p_quantity then
    raise exception 'not enough inventory';
  end if;

  for batch_row in
    select *
    from public.inventory_batches
    where medicine_id = p_medicine_id and quantity > 0
    order by expiry_date asc, created_at asc
    for update
  loop
    exit when remaining <= 0;
    take_qty := least(remaining, batch_row.quantity);

    update public.inventory_batches
    set quantity = quantity - take_qty, updated_at = now()
    where id = batch_row.id
    returning * into batch_row;

    insert into public.inventory_movements (
      medicine_id, batch_id, batch_number, movement_type,
      quantity, balance, note, created_by
    )
    values (
      p_medicine_id, batch_row.id, batch_row.batch_number, 'out',
      take_qty, batch_row.quantity, p_note, auth.uid()
    );

    remaining := remaining - take_qty;
    batch_id := batch_row.id;
    batch_number := batch_row.batch_number;
    quantity := take_qty;
    balance := batch_row.quantity;
    return next;
  end loop;
end;
$$;

create or replace function public.rpc_stock_dispose(
  p_batch_id uuid,
  p_quantity integer,
  p_reason text default null,
  p_note text default null
)
returns table(batch_id uuid, batch_number text, quantity integer, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_row public.inventory_batches%rowtype;
begin
  if not public.has_clinic_permission('disposal.create') then
    raise exception 'permission denied: disposal.create';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than zero';
  end if;

  select * into batch_row
  from public.inventory_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'batch not found';
  end if;
  if batch_row.quantity < p_quantity then
    raise exception 'not enough inventory';
  end if;

  update public.inventory_batches
  set quantity = quantity - p_quantity, updated_at = now()
  where id = p_batch_id
  returning * into batch_row;

  insert into public.inventory_movements (
    medicine_id, batch_id, batch_number, movement_type,
    quantity, balance, note, created_by
  )
  values (
    batch_row.medicine_id, batch_row.id, batch_row.batch_number, 'dispose',
    p_quantity, batch_row.quantity, concat_ws(' - ', p_reason, p_note), auth.uid()
  );

  return query select batch_row.id, batch_row.batch_number, p_quantity, batch_row.quantity;
end;
$$;

create or replace function public.rpc_stock_count(
  p_batch_id uuid,
  p_actual_quantity integer,
  p_note text default null
)
returns table(batch_id uuid, batch_number text, quantity integer, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_row public.inventory_batches%rowtype;
  diff_qty integer;
begin
  if not public.has_clinic_permission('inventory.count') then
    raise exception 'permission denied: inventory.count';
  end if;
  if p_actual_quantity is null or p_actual_quantity < 0 then
    raise exception 'actual quantity must be zero or greater';
  end if;

  select * into batch_row
  from public.inventory_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'batch not found';
  end if;

  diff_qty := p_actual_quantity - batch_row.quantity;

  update public.inventory_batches
  set quantity = p_actual_quantity, updated_at = now()
  where id = p_batch_id
  returning * into batch_row;

  insert into public.inventory_movements (
    medicine_id, batch_id, batch_number, movement_type,
    quantity, balance, note, created_by
  )
  values (
    batch_row.medicine_id, batch_row.id, batch_row.batch_number, 'count',
    diff_qty, batch_row.quantity, p_note, auth.uid()
  );

  return query select batch_row.id, batch_row.batch_number, diff_qty, batch_row.quantity;
end;
$$;

alter table public.profiles enable row level security;
alter table public.medicines enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.public_catalog enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select to authenticated
using (id = auth.uid() or public.current_profile_role() = 'admin');

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists medicines_read_authenticated on public.medicines;
create policy medicines_read_authenticated on public.medicines
for select to authenticated
using (public.has_clinic_permission('alerts.view') or public.has_clinic_permission('transactions.view'));

drop policy if exists medicines_create_allowed on public.medicines;
create policy medicines_create_allowed on public.medicines
for insert to authenticated
with check (public.has_clinic_permission('medicine.create'));

drop policy if exists medicines_edit_allowed on public.medicines;
create policy medicines_edit_allowed on public.medicines
for update to authenticated
using (public.has_clinic_permission('medicine.edit'))
with check (public.has_clinic_permission('medicine.edit'));

drop policy if exists medicines_delete_admin on public.medicines;
create policy medicines_delete_admin on public.medicines
for delete to authenticated
using (public.current_profile_role() = 'admin');

drop policy if exists batches_read_authenticated on public.inventory_batches;
create policy batches_read_authenticated on public.inventory_batches
for select to authenticated
using (public.has_clinic_permission('alerts.view') or public.has_clinic_permission('transactions.view'));

drop policy if exists batches_rpc_write_only on public.inventory_batches;
create policy batches_rpc_write_only on public.inventory_batches
for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists movements_read_authenticated on public.inventory_movements;
create policy movements_read_authenticated on public.inventory_movements
for select to authenticated
using (public.has_clinic_permission('transactions.view'));

drop policy if exists movements_admin_write on public.inventory_movements;
create policy movements_admin_write on public.inventory_movements
for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists catalog_public_read on public.public_catalog;
create policy catalog_public_read on public.public_catalog
for select to anon, authenticated
using (visible is true);

drop policy if exists catalog_manage_authenticated on public.public_catalog;
create policy catalog_manage_authenticated on public.public_catalog
for all to authenticated
using (public.has_clinic_permission('public.manage'))
with check (public.has_clinic_permission('public.manage'));

drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs
for select to authenticated
using (public.current_profile_role() = 'admin');

drop policy if exists audit_authenticated_insert on public.audit_logs;
create policy audit_authenticated_insert on public.audit_logs
for insert to authenticated
with check (auth.uid() is not null);

grant usage on schema public to anon, authenticated;
grant select on public.public_catalog to anon;
grant select, insert, update, delete on public.medicines to authenticated;
grant select, insert, update, delete on public.inventory_batches to authenticated;
grant select, insert, update, delete on public.inventory_movements to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.audit_logs to authenticated;
grant execute on function public.rpc_stock_in(uuid, text, integer, date, date, text, text, text) to authenticated;
grant execute on function public.rpc_stock_out(uuid, integer, text) to authenticated;
grant execute on function public.rpc_stock_dispose(uuid, integer, text, text) to authenticated;
grant execute on function public.rpc_stock_count(uuid, integer, text) to authenticated;
grant execute on function public.has_clinic_permission(text) to authenticated;
