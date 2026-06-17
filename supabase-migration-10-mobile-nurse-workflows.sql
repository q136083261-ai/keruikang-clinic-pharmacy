-- Keruikang clinic pharmacy
-- Migration 10: mobile nurse role and manual mobile stock workflows.
--
-- Run the following check first if you want to inspect the current schema:
--
-- select
--   table_name,
--   column_name,
--   data_type,
--   is_nullable,
--   column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in (
--     'medicines',
--     'inventory_batches',
--     'inventory_movements',
--     'clinic_users',
--     'user_profiles',
--     'medicine_batch_drafts'
--   )
-- order by table_name, ordinal_position;
--
-- This patch does not import data.
-- This patch does not write trace_codes, medicine_code_mappings, or drug_lookup_logs.
-- It only adds nurse-compatible permissions and mobile manual stock RPCs.

create extension if not exists pgcrypto;

create index if not exists inventory_batches_mobile_lookup_idx
  on public.inventory_batches(medicine_id, expiry_date, created_at);

create index if not exists inventory_movements_mobile_created_idx
  on public.inventory_movements(created_by, created_at desc);

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
        or (
          role = 'operator'
          and permission_name = any(array[
            'medicine.create','medicine.edit','stock.in','stock.out',
            'inventory.count','disposal.create','alerts.view','transactions.view',
            'purchase.manage','public.manage'
          ])
        )
        or (
          role in ('nurse','stock_operator')
          and permission_name = any(array[
            'medicines.read','medicine.create','medicines.create',
            'inventory.read','stock.in','stock.out','batch.read','batch.create'
          ])
        )
      )
  );
$$;

grant execute on function public.has_clinic_permission(text) to authenticated;

create or replace function public._mobile_insert_inventory_movement(
  p_medicine_id uuid,
  p_batch_id uuid,
  p_batch_number text,
  p_movement_type text,
  p_quantity integer,
  p_balance integer,
  p_unit text default null,
  p_reason text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_columns text;
  v_missing_required text;
  v_movement_id uuid;
begin
  v_payload := jsonb_build_object(
    'medicine_id', p_medicine_id,
    'batch_id', p_batch_id,
    'batch_number', p_batch_number,
    'movement_type', p_movement_type,
    'action', p_movement_type,
    'type', p_movement_type,
    'direction', p_movement_type,
    'quantity', p_quantity,
    'balance', p_balance,
    'unit', coalesce(nullif(trim(coalesce(p_unit, '')), ''), '盒'),
    'reason', coalesce(nullif(trim(coalesce(p_reason, '')), ''), case when p_movement_type = 'in' then '入库' else '出库' end),
    'note', coalesce(nullif(trim(coalesce(p_note, '')), ''), nullif(trim(coalesce(p_reason, '')), ''), p_movement_type),
    'source', 'mobile_nurse',
    'created_by', auth.uid(),
    'operator_id', auth.uid(),
    'user_id', auth.uid()
  );

  select string_agg(c.column_name, ', ' order by c.ordinal_position)
  into v_missing_required
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'inventory_movements'
    and c.is_nullable = 'NO'
    and c.column_default is null
    and coalesce(c.identity_generation, '') = ''
    and not (v_payload ? c.column_name);

  if v_missing_required is not null then
    raise exception 'inventory_movements has unsupported required columns: %', v_missing_required;
  end if;

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
  into v_columns
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'inventory_movements'
    and (v_payload ? c.column_name);

  if v_columns is null then
    raise exception 'inventory_movements columns not found';
  end if;

  execute format(
    'insert into public.inventory_movements (%1$s)
     select %1$s from jsonb_populate_record(null::public.inventory_movements, $1)
     returning id',
    v_columns
  )
  using v_payload
  into v_movement_id;

  return v_movement_id;
end;
$$;

revoke execute on function public._mobile_insert_inventory_movement(
  uuid, uuid, text, text, integer, integer, text, text, text
) from public, anon, authenticated;

create or replace function public.rpc_mobile_stock_in_v1(
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
  v_batch public.inventory_batches%rowtype;
  v_batch_number text := nullif(trim(coalesce(p_batch_number, '')), '');
  v_default_unit text;
  v_unit text;
  v_before_quantity integer := 0;
  v_after_quantity integer := 0;
begin
  if not public.has_clinic_permission('stock.in') then
    raise exception 'permission denied: stock.in';
  end if;

  select m.default_unit
  into v_default_unit
  from public.medicines as m
  where m.id = p_medicine_id
    and m.active is not false;

  if not found then
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

  v_unit := coalesce(nullif(trim(coalesce(p_unit, '')), ''), v_default_unit, '盒');

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
        source = coalesce(b.source, 'mobile_nurse_stock_in'),
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
      'mobile_nurse_stock_in',
      auth.uid()
    )
    returning * into v_batch;
  end if;

  v_after_quantity := coalesce(v_batch.quantity, 0);
  movement_id := public._mobile_insert_inventory_movement(
    p_medicine_id,
    v_batch.id,
    v_batch.batch_number,
    'in',
    p_quantity,
    v_after_quantity,
    v_unit,
    '入库',
    p_note
  );

  batch_id := v_batch.id;
  before_quantity := v_before_quantity;
  after_quantity := v_after_quantity;
  return next;
end;
$$;

create or replace function public.rpc_mobile_stock_out_v1(
  p_medicine_id uuid,
  p_batch_id uuid,
  p_quantity integer,
  p_reason text default null,
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
  v_batch public.inventory_batches%rowtype;
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), '发药');
  v_note text;
begin
  if not public.has_clinic_permission('stock.out') then
    raise exception 'permission denied: stock.out';
  end if;

  if p_medicine_id is null then
    raise exception 'medicine_id is required';
  end if;

  if p_batch_id is null then
    raise exception 'batch_id is required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than zero';
  end if;

  select b.* into v_batch
  from public.inventory_batches as b
  where b.id = p_batch_id
    and b.medicine_id = p_medicine_id
  for update;

  if not found then
    raise exception 'batch not found';
  end if;

  if coalesce(v_batch.quantity, 0) < p_quantity then
    raise exception 'not enough inventory';
  end if;

  before_quantity := coalesce(v_batch.quantity, 0);

  update public.inventory_batches as b
  set quantity = b.quantity - p_quantity,
      updated_at = now()
  where b.id = v_batch.id
  returning b.* into v_batch;

  after_quantity := coalesce(v_batch.quantity, 0);
  v_note := concat_ws(' - ', v_reason, nullif(trim(coalesce(p_note, '')), ''));

  movement_id := public._mobile_insert_inventory_movement(
    p_medicine_id,
    v_batch.id,
    v_batch.batch_number,
    'out',
    p_quantity,
    after_quantity,
    v_batch.unit,
    v_reason,
    v_note
  );

  batch_id := v_batch.id;
  return next;
end;
$$;

grant execute on function public.rpc_mobile_stock_in_v1(
  uuid, integer, text, date, date, text, numeric, text
) to authenticated;

grant execute on function public.rpc_mobile_stock_out_v1(
  uuid, uuid, integer, text, text
) to authenticated;

drop policy if exists medicines_read_authenticated on public.medicines;
create policy medicines_read_authenticated on public.medicines
for select to authenticated
using (
  public.has_clinic_permission('medicines.read')
  or public.has_clinic_permission('medicine.create')
  or public.has_clinic_permission('stock.in')
  or public.has_clinic_permission('stock.out')
  or public.has_clinic_permission('alerts.view')
  or public.has_clinic_permission('transactions.view')
);

drop policy if exists batches_read_authenticated on public.inventory_batches;
create policy batches_read_authenticated on public.inventory_batches
for select to authenticated
using (
  public.has_clinic_permission('inventory.read')
  or public.has_clinic_permission('batch.read')
  or public.has_clinic_permission('stock.in')
  or public.has_clinic_permission('stock.out')
  or public.has_clinic_permission('alerts.view')
  or public.has_clinic_permission('transactions.view')
);

drop policy if exists movements_read_authenticated on public.inventory_movements;
create policy movements_read_authenticated on public.inventory_movements
for select to authenticated
using (
  public.has_clinic_permission('inventory.read')
  or public.has_clinic_permission('stock.in')
  or public.has_clinic_permission('stock.out')
  or public.has_clinic_permission('transactions.view')
);
