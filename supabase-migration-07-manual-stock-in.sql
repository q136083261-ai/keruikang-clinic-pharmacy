-- Keruikang clinic pharmacy
-- Migration 07: pure manual stock-in RPC.
-- Run this in Supabase SQL Editor before using the new manual stock-in flow.
--
-- This patch does not import data.
-- This patch does not write trace_codes, medicine_code_mappings, or drug_lookup_logs.
-- It only adds a new RPC for stable manual inbound inventory transactions.

create index if not exists inventory_batches_manual_lookup_idx
  on public.inventory_batches(medicine_id, batch_number, expiry_date);

create index if not exists inventory_movements_batch_created_idx
  on public.inventory_movements(batch_id, created_at desc);

create or replace function public.rpc_manual_stock_in_v1(
  p_medicine_id uuid,
  p_quantity integer,
  p_batch_number text,
  p_production_date date,
  p_expiry_date date,
  p_unit text default null,
  p_retail_price numeric default null,
  p_note text default null
)
returns table(
  batch_id uuid,
  movement_id uuid,
  before_quantity integer,
  after_quantity integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_medicine_exists boolean;
  v_batch public.inventory_batches%rowtype;
  v_movement public.inventory_movements%rowtype;
  v_batch_number text := nullif(trim(coalesce(p_batch_number, '')), '');
  v_unit text := nullif(trim(coalesce(p_unit, '')), '');
  v_before_quantity integer := 0;
  v_after_quantity integer := 0;
begin
  if not public.has_clinic_permission('stock.in') then
    raise exception 'permission denied: stock.in';
  end if;

  select exists (
    select 1
    from public.medicines as m
    where m.id = p_medicine_id
      and m.active is not false
  )
  into v_medicine_exists;

  if v_medicine_exists is not true then
    raise exception 'medicine not found or inactive';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than zero';
  end if;

  if v_batch_number is null then
    raise exception 'batch_number is required';
  end if;

  if p_production_date is null then
    raise exception 'production_date is required';
  end if;

  if p_expiry_date is null then
    raise exception 'expiry_date is required';
  end if;

  if p_expiry_date <= p_production_date then
    raise exception 'expiry date must be later than production date';
  end if;

  select b.* into v_batch
  from public.inventory_batches as b
  where b.medicine_id = p_medicine_id
    and b.batch_number = v_batch_number
    and b.expiry_date = p_expiry_date
  order by b.created_at asc
  limit 1
  for update;

  if found then
    v_before_quantity := coalesce(v_batch.quantity, 0);

    update public.inventory_batches as b
    set quantity = b.quantity + p_quantity,
        production_date = p_production_date,
        unit = coalesce(v_unit, b.unit),
        retail_price = coalesce(p_retail_price, b.retail_price),
        source = coalesce(b.source, 'manual_stock_in_v1'),
        updated_at = now()
    where b.id = v_batch.id
    returning b.* into v_batch;
  else
    insert into public.inventory_batches (
      medicine_id,
      batch_number,
      production_date,
      expiry_date,
      expiry_precision,
      quantity,
      unit,
      retail_price,
      source,
      created_by
    )
    values (
      p_medicine_id,
      v_batch_number,
      p_production_date,
      p_expiry_date,
      'day',
      p_quantity,
      v_unit,
      p_retail_price,
      'manual_stock_in_v1',
      auth.uid()
    )
    returning * into v_batch;
  end if;

  v_after_quantity := coalesce(v_batch.quantity, 0);

  insert into public.inventory_movements (
    medicine_id,
    batch_id,
    batch_number,
    movement_type,
    quantity,
    balance,
    note,
    created_by
  )
  values (
    p_medicine_id,
    v_batch.id,
    v_batch.batch_number,
    'in',
    p_quantity,
    v_after_quantity,
    p_note,
    auth.uid()
  )
  returning * into v_movement;

  batch_id := v_batch.id;
  movement_id := v_movement.id;
  before_quantity := v_before_quantity;
  after_quantity := v_after_quantity;
  return next;
end;
$$;

grant execute on function public.rpc_manual_stock_in_v1(
  uuid, integer, text, date, date, text, numeric, text
) to authenticated;
