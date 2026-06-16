-- Keruikang clinic pharmacy
-- Migration 06: fix ambiguous batch_number/quantity references in inventory RPCs.
-- Run this in Supabase SQL Editor after migrations 03 and 04.
--
-- This patch does not import data and does not write stock records by itself.
-- It only replaces RPC functions so stock-in/out/count/dispose use explicit
-- table aliases and a private batch upsert helper.

create extension if not exists pgcrypto;

alter table public.inventory_batches
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists production_date date,
  add column if not exists expiry_precision text default 'day',
  add column if not exists unit text,
  add column if not exists location text,
  add column if not exists retail_price numeric,
  add column if not exists supplier_name text,
  add column if not exists source text,
  add column if not exists external_snapshot jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists inventory_batches_identity_idx
  on public.inventory_batches(medicine_id, batch_number, expiry_date);

create or replace function public._inventory_upsert_batch(
  p_medicine_id uuid,
  p_batch_number text,
  p_quantity integer,
  p_production_date date,
  p_expiry_date date,
  p_expiry_precision text default null,
  p_unit text default null,
  p_location text default null,
  p_retail_price numeric default null,
  p_supplier_name text default null,
  p_source text default null,
  p_external_snapshot jsonb default null,
  p_actor uuid default null
)
returns public.inventory_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.inventory_batches%rowtype;
  v_batch_number text := nullif(trim(coalesce(p_batch_number, '')), '');
  v_expiry_precision text := nullif(trim(coalesce(p_expiry_precision, '')), '');
  v_unit text := nullif(trim(coalesce(p_unit, '')), '');
  v_location text := nullif(trim(coalesce(p_location, '')), '');
  v_supplier_name text := nullif(trim(coalesce(p_supplier_name, '')), '');
  v_source text := nullif(trim(coalesce(p_source, '')), '');
begin
  if p_medicine_id is null then
    raise exception 'medicine_id is required';
  end if;
  if v_batch_number is null then
    raise exception 'batch_number is required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than zero';
  end if;
  if p_production_date is null or p_expiry_date is null or p_expiry_date <= p_production_date then
    raise exception 'expiry date must be later than production date';
  end if;

  select b.* into v_batch
  from public.inventory_batches as b
  where b.medicine_id = p_medicine_id
    and b.batch_number = v_batch_number
    and b.expiry_date = p_expiry_date
  for update;

  if found then
    update public.inventory_batches as b
    set quantity = b.quantity + p_quantity,
        production_date = p_production_date,
        expiry_precision = coalesce(v_expiry_precision, b.expiry_precision, 'day'),
        unit = coalesce(v_unit, b.unit),
        location = coalesce(v_location, b.location),
        retail_price = coalesce(p_retail_price, b.retail_price),
        supplier_name = coalesce(v_supplier_name, b.supplier_name),
        source = coalesce(v_source, b.source),
        external_snapshot = coalesce(p_external_snapshot, b.external_snapshot),
        updated_at = now()
    where b.id = v_batch.id
    returning b.* into v_batch;
  else
    insert into public.inventory_batches (
      medicine_id, batch_number, production_date, expiry_date, expiry_precision,
      quantity, unit, location, retail_price, supplier_name, source,
      external_snapshot, created_by
    )
    values (
      p_medicine_id, v_batch_number, p_production_date, p_expiry_date,
      coalesce(v_expiry_precision, 'day'), p_quantity, v_unit, v_location,
      p_retail_price, v_supplier_name, v_source,
      coalesce(p_external_snapshot, '{}'::jsonb), p_actor
    )
    returning * into v_batch;
  end if;

  return v_batch;
end;
$$;

revoke execute on function public._inventory_upsert_batch(
  uuid, text, integer, date, date, text, text, text, numeric, text, text, jsonb, uuid
) from public, anon, authenticated;

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

  target_batch := public._inventory_upsert_batch(
    p_medicine_id,
    p_batch_number,
    p_quantity,
    p_production_date,
    p_expiry_date,
    'day',
    p_unit,
    p_location,
    null,
    null,
    'manual_stock_in',
    '{}'::jsonb,
    auth.uid()
  );

  insert into public.inventory_movements (
    medicine_id, batch_id, batch_number, movement_type,
    quantity, balance, note, created_by
  )
  values (
    p_medicine_id, target_batch.id, target_batch.batch_number, 'in',
    p_quantity, target_batch.quantity, p_note, auth.uid()
  );

  batch_id := target_batch.id;
  batch_number := target_batch.batch_number;
  quantity := p_quantity;
  balance := target_batch.quantity;
  return next;
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

  select coalesce(sum(b.quantity), 0) into available_qty
  from public.inventory_batches as b
  where b.medicine_id = p_medicine_id
    and b.quantity > 0;

  if available_qty < p_quantity then
    raise exception 'not enough inventory';
  end if;

  for batch_row in
    select b.*
    from public.inventory_batches as b
    where b.medicine_id = p_medicine_id
      and b.quantity > 0
    order by b.expiry_date asc, b.created_at asc
    for update
  loop
    exit when remaining <= 0;
    take_qty := least(remaining, batch_row.quantity);

    update public.inventory_batches as b
    set quantity = b.quantity - take_qty,
        updated_at = now()
    where b.id = batch_row.id
    returning b.* into batch_row;

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

  select b.* into batch_row
  from public.inventory_batches as b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'batch not found';
  end if;
  if batch_row.quantity < p_quantity then
    raise exception 'not enough inventory';
  end if;

  update public.inventory_batches as b
  set quantity = b.quantity - p_quantity,
      updated_at = now()
  where b.id = p_batch_id
  returning b.* into batch_row;

  insert into public.inventory_movements (
    medicine_id, batch_id, batch_number, movement_type,
    quantity, balance, note, created_by
  )
  values (
    batch_row.medicine_id, batch_row.id, batch_row.batch_number, 'dispose',
    p_quantity, batch_row.quantity, concat_ws(' - ', p_reason, p_note), auth.uid()
  );

  batch_id := batch_row.id;
  batch_number := batch_row.batch_number;
  quantity := p_quantity;
  balance := batch_row.quantity;
  return next;
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

  select b.* into batch_row
  from public.inventory_batches as b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'batch not found';
  end if;

  diff_qty := p_actual_quantity - batch_row.quantity;

  update public.inventory_batches as b
  set quantity = p_actual_quantity,
      updated_at = now()
  where b.id = p_batch_id
  returning b.* into batch_row;

  insert into public.inventory_movements (
    medicine_id, batch_id, batch_number, movement_type,
    quantity, balance, note, created_by
  )
  values (
    batch_row.medicine_id, batch_row.id, batch_row.batch_number, 'count',
    diff_qty, batch_row.quantity, p_note, auth.uid()
  );

  batch_id := batch_row.id;
  batch_number := batch_row.batch_number;
  quantity := diff_qty;
  balance := batch_row.quantity;
  return next;
end;
$$;

grant execute on function public.rpc_stock_in(uuid, text, integer, date, date, text, text, text) to authenticated;
grant execute on function public.rpc_stock_out(uuid, integer, text) to authenticated;
grant execute on function public.rpc_stock_dispose(uuid, integer, text, text) to authenticated;
grant execute on function public.rpc_stock_count(uuid, integer, text) to authenticated;
