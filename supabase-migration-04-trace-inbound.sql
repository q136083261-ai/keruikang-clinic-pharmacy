-- Keruikang clinic pharmacy
-- Migration 04: trace-code duplicate guard and one-transaction inbound flow.
-- Run once in Supabase SQL Editor after migration 03.

create extension if not exists pgcrypto;

alter table public.medicines
  add column if not exists normalized_name text,
  add column if not exists external_source text,
  add column if not exists external_drug_id text,
  add column if not exists product_resource_code text,
  add column if not exists gtin text,
  add column if not exists barcode_69 text,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists updated_by uuid references auth.users(id);

alter table public.inventory_batches
  add column if not exists expiry_precision text default 'day',
  add column if not exists purchase_price numeric,
  add column if not exists retail_price numeric,
  add column if not exists supplier_name text,
  add column if not exists source text,
  add column if not exists external_snapshot jsonb default '{}'::jsonb;

create table if not exists public.medicine_code_mappings (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  code_type text not null check (code_type in ('trace_product_code','trace_full_code','barcode_69','gtin','approval_no','external_drug_id')),
  code_value text not null,
  source text,
  confidence numeric,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (code_type, code_value)
);

create index if not exists medicine_code_mappings_medicine_idx
  on public.medicine_code_mappings(medicine_id);

create table if not exists public.trace_codes (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  batch_id uuid references public.inventory_batches(id) on delete set null,
  raw_code text not null,
  trace_code text not null unique,
  code_type text,
  serial_no text,
  product_resource_code text,
  package_level text,
  code_status text,
  status text not null default 'in_stock' check (status in ('in_stock','sold','returned','damaged','corrected')),
  external_source text,
  external_response jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists trace_codes_medicine_idx
  on public.trace_codes(medicine_id, created_at desc);

create index if not exists trace_codes_batch_idx
  on public.trace_codes(batch_id);

create table if not exists public.drug_lookup_logs (
  id uuid primary key default gen_random_uuid(),
  raw_code text,
  code_type text,
  provider text,
  request_payload jsonb default '{}'::jsonb,
  response_payload jsonb default '{}'::jsonb,
  success boolean default false,
  error_code text,
  message text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists drug_lookup_logs_created_idx
  on public.drug_lookup_logs(created_at desc);

create or replace function public.normalize_drug_text(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(coalesce(value, '')), '\s+', '', 'g'), '');
$$;

create or replace function public.parse_trace_payload(raw_code text)
returns jsonb
language plpgsql
immutable
as $$
declare
  digits text := regexp_replace(coalesce(raw_code, ''), '\D', '', 'g');
  product_code text := null;
  serial text := null;
  code_type text := 'unknown';
begin
  if digits ~ '^8[0-9]{19}$' then
    product_code := substring(digits from 1 for 7);
    serial := substring(digits from 8);
    code_type := 'MSFX_20';
  elsif digits ~ '^[0-9]{18,26}$' then
    product_code := substring(digits from 1 for 7);
    serial := substring(digits from 8);
    code_type := 'TRACE_NUMERIC';
  elsif digits ~ '^[0-9]{13}$' then
    code_type := 'EAN13';
  end if;

  return jsonb_build_object(
    'rawCode', raw_code,
    'digits', digits,
    'codeType', code_type,
    'traceCode', case when code_type in ('MSFX_20','TRACE_NUMERIC') then digits else null end,
    'productResourceCode', product_code,
    'serialNo', serial
  );
end;
$$;

create or replace function public.rpc_trace_code_status(p_raw_code text)
returns table(
  success boolean,
  code_type text,
  raw_code text,
  trace_code text,
  product_resource_code text,
  serial_no text,
  duplicate boolean,
  existing_trace_code_id uuid,
  medicine_id uuid,
  drug_name text,
  approval_no text,
  manufacturer text,
  package_spec text,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  parsed jsonb := public.parse_trace_payload(p_raw_code);
  found_trace public.trace_codes%rowtype;
  found_medicine public.medicines%rowtype;
  mapping_row public.medicine_code_mappings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into found_trace
  from public.trace_codes
  where trace_code = parsed->>'traceCode'
     or raw_code = p_raw_code
  limit 1;

  if found_trace.id is not null then
    select * into found_medicine from public.medicines where id = found_trace.medicine_id;
    return query select
      true,
      parsed->>'codeType',
      p_raw_code,
      found_trace.trace_code,
      found_trace.product_resource_code,
      found_trace.serial_no,
      true,
      found_trace.id,
      found_trace.medicine_id,
      found_medicine.name,
      found_medicine.approval_number,
      found_medicine.manufacturer,
      found_medicine.specification,
      '该盒药已经入库，不能重复录入。';
    return;
  end if;

  select * into mapping_row
  from public.medicine_code_mappings
  where (code_type = 'trace_product_code' and code_value = parsed->>'productResourceCode')
     or (code_type = 'trace_full_code' and code_value = parsed->>'traceCode')
     or (code_type = 'barcode_69' and code_value = regexp_replace(coalesce(p_raw_code, ''), '\D', '', 'g'))
     or (code_type = 'gtin' and code_value = regexp_replace(coalesce(p_raw_code, ''), '\D', '', 'g'))
  order by confidence desc nulls last, created_at desc
  limit 1;

  if mapping_row.id is not null then
    select * into found_medicine from public.medicines where id = mapping_row.medicine_id;
  end if;

  return query select
    true,
    parsed->>'codeType',
    p_raw_code,
    parsed->>'traceCode',
    parsed->>'productResourceCode',
    parsed->>'serialNo',
    false,
    null::uuid,
    found_medicine.id,
    found_medicine.name,
    found_medicine.approval_number,
    found_medicine.manufacturer,
    found_medicine.specification,
    case when found_medicine.id is null then '未匹配本地药品主档。' else '已匹配本地药品主档。' end;
end;
$$;

create or replace function public.upsert_medicine_mapping(
  p_medicine_id uuid,
  p_code_type text,
  p_code_value text,
  p_source text default null,
  p_confidence numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_medicine_id is null or nullif(trim(coalesce(p_code_value, '')), '') is null then
    return;
  end if;

  insert into public.medicine_code_mappings (
    medicine_id, code_type, code_value, source, confidence, created_by
  )
  values (
    p_medicine_id, p_code_type, trim(p_code_value), p_source, p_confidence, auth.uid()
  )
  on conflict (code_type, code_value)
  do update set
    medicine_id = excluded.medicine_id,
    source = coalesce(excluded.source, public.medicine_code_mappings.source),
    confidence = coalesce(excluded.confidence, public.medicine_code_mappings.confidence);
end;
$$;

create or replace function public.rpc_trace_inbound(p_payload jsonb)
returns table(
  medicine_id uuid,
  batch_id uuid,
  trace_code_id uuid,
  created_medicine boolean,
  batch_balance integer,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  confirmed boolean := coalesce((p_payload->>'userConfirmed')::boolean, false);
  medicine_payload jsonb := coalesce(p_payload->'confirmedFields', '{}'::jsonb);
  lookup_payload jsonb := coalesce(p_payload->'lookupResult', '{}'::jsonb);
  raw_code text := nullif(trim(coalesce(lookup_payload->>'rawCode', medicine_payload->>'barcode', p_payload->>'rawCode', '')), '');
  v_trace_code text := nullif(trim(coalesce(lookup_payload->>'traceCode', '')), '');
  parsed jsonb := public.parse_trace_payload(coalesce(v_trace_code, raw_code, ''));
  target_medicine public.medicines%rowtype;
  target_batch public.inventory_batches%rowtype;
  qty integer := coalesce((medicine_payload->>'quantity')::integer, 0);
  batch_no text := nullif(trim(coalesce(medicine_payload->>'batchNo', lookup_payload->>'batchNo', '')), '');
  production_date date := nullif(coalesce(medicine_payload->>'productionDate', lookup_payload->>'productionDate', ''), '')::date;
  expiry_date date := nullif(coalesce(medicine_payload->>'expiryDate', lookup_payload->>'expiryDate', ''), '')::date;
  before_qty integer := 0;
  use_medicine_id uuid := nullif(coalesce(medicine_payload->>'medicineId', lookup_payload->>'medicineId', ''), '')::uuid;
begin
  if not public.has_clinic_permission('stock.in') then
    raise exception 'permission denied: stock.in';
  end if;
  if confirmed is not true then
    raise exception '请先核对并勾选确认。';
  end if;
  if qty <= 0 then
    raise exception '入库数量必须大于 0。';
  end if;
  if batch_no is null then
    raise exception '请填写批号。';
  end if;
  if production_date is null or expiry_date is null or expiry_date <= production_date then
    raise exception '生产日期和有效期不正确。';
  end if;
  if nullif(trim(coalesce(medicine_payload->>'drugName', medicine_payload->>'name', '')), '') is null then
    raise exception '请填写药品名称。';
  end if;

  v_trace_code := coalesce(v_trace_code, parsed->>'traceCode');

  if v_trace_code is not null and exists (select 1 from public.trace_codes where public.trace_codes.trace_code = v_trace_code) then
    raise exception 'DUPLICATE_TRACE_CODE: 该盒药已经入库，不能重复录入。';
  end if;

  if use_medicine_id is not null then
    select * into target_medicine from public.medicines where id = use_medicine_id for update;
  end if;

  if target_medicine.id is null and nullif(coalesce(medicine_payload->>'approvalNo', medicine_payload->>'code', ''), '') is not null then
    select * into target_medicine
    from public.medicines
    where approval_number = coalesce(medicine_payload->>'approvalNo', medicine_payload->>'code')
      and coalesce(manufacturer, '') = coalesce(medicine_payload->>'manufacturer', manufacturer, '')
      and coalesce(specification, '') = coalesce(medicine_payload->>'packageSpec', medicine_payload->>'spec', specification, '')
    limit 1
    for update;
  end if;

  if target_medicine.id is null and nullif(parsed->>'productResourceCode', '') is not null then
    select m.* into target_medicine
    from public.medicine_code_mappings map
    join public.medicines m on m.id = map.medicine_id
    where map.code_type = 'trace_product_code'
      and map.code_value = parsed->>'productResourceCode'
    limit 1
    for update;
  end if;

  if target_medicine.id is null then
    insert into public.medicines (
      name, normalized_name, barcode, barcode_69, gtin, category, specification,
      manufacturer, approval_number, default_unit, retail_price, low_stock_threshold,
      external_source, external_drug_id, product_resource_code, active, created_by, updated_by
    )
    values (
      trim(coalesce(medicine_payload->>'drugName', medicine_payload->>'name')),
      public.normalize_drug_text(coalesce(medicine_payload->>'drugName', medicine_payload->>'name')),
      coalesce(raw_code, medicine_payload->>'barcode'),
      medicine_payload->>'barcode69',
      medicine_payload->>'gtin',
      nullif(coalesce(medicine_payload->>'category', lookup_payload->>'category'), ''),
      nullif(coalesce(medicine_payload->>'packageSpec', medicine_payload->>'spec'), ''),
      nullif(coalesce(medicine_payload->>'manufacturer', lookup_payload->>'manufacturer'), ''),
      nullif(coalesce(medicine_payload->>'approvalNo', medicine_payload->>'code', lookup_payload->>'approvalNo'), ''),
      coalesce(nullif(medicine_payload->>'unit', ''), '盒'),
      nullif(medicine_payload->>'retailPrice', '')::numeric,
      coalesce(nullif(medicine_payload->>'stockWarning', '')::integer, nullif(medicine_payload->>'minStock', '')::integer, 20),
      nullif(lookup_payload->>'externalSource', ''),
      nullif(lookup_payload->>'externalDrugId', ''),
      coalesce(nullif(lookup_payload->>'productResourceCode', ''), nullif(parsed->>'productResourceCode', '')),
      true,
      auth.uid(),
      auth.uid()
    )
    returning * into target_medicine;
    created_medicine := true;
  else
    created_medicine := false;
  end if;

  perform public.upsert_medicine_mapping(target_medicine.id, 'approval_no', target_medicine.approval_number, 'confirmed', 0.95);
  perform public.upsert_medicine_mapping(target_medicine.id, 'trace_product_code', coalesce(lookup_payload->>'productResourceCode', parsed->>'productResourceCode'), 'scan', 0.9);
  perform public.upsert_medicine_mapping(target_medicine.id, 'trace_full_code', v_trace_code, 'scan', 0.7);
  perform public.upsert_medicine_mapping(target_medicine.id, 'barcode_69', coalesce(medicine_payload->>'barcode69', medicine_payload->>'barcode'), 'confirmed', 0.8);
  perform public.upsert_medicine_mapping(target_medicine.id, 'gtin', medicine_payload->>'gtin', 'confirmed', 0.85);
  perform public.upsert_medicine_mapping(target_medicine.id, 'external_drug_id', lookup_payload->>'externalDrugId', lookup_payload->>'externalSource', 0.95);

  insert into public.inventory_batches (
    medicine_id, batch_number, production_date, expiry_date, expiry_precision,
    quantity, unit, retail_price, supplier_name, source, external_snapshot, created_by
  )
  values (
    target_medicine.id,
    batch_no,
    production_date,
    expiry_date,
    coalesce(nullif(medicine_payload->>'expiryPrecision', ''), 'day'),
    qty,
    coalesce(nullif(medicine_payload->>'unit', ''), target_medicine.default_unit, '盒'),
    nullif(medicine_payload->>'retailPrice', '')::numeric,
    nullif(medicine_payload->>'supplierName', ''),
    coalesce(nullif(lookup_payload->>'source', ''), 'confirmed_inbound'),
    lookup_payload,
    auth.uid()
  )
  on conflict (medicine_id, batch_number, expiry_date)
  do update set
    quantity = public.inventory_batches.quantity + excluded.quantity,
    production_date = excluded.production_date,
    unit = coalesce(excluded.unit, public.inventory_batches.unit),
    retail_price = coalesce(excluded.retail_price, public.inventory_batches.retail_price),
    supplier_name = coalesce(excluded.supplier_name, public.inventory_batches.supplier_name),
    source = coalesce(excluded.source, public.inventory_batches.source),
    external_snapshot = coalesce(excluded.external_snapshot, public.inventory_batches.external_snapshot),
    updated_at = now()
  returning * into target_batch;

  before_qty := target_batch.quantity - qty;

  if v_trace_code is not null then
    insert into public.trace_codes (
      medicine_id, batch_id, raw_code, trace_code, code_type, serial_no,
      product_resource_code, package_level, code_status, status,
      external_source, external_response, created_by
    )
    values (
      target_medicine.id,
      target_batch.id,
      coalesce(raw_code, v_trace_code),
      v_trace_code,
      coalesce(lookup_payload->>'codeType', parsed->>'codeType'),
      coalesce(lookup_payload->>'serialNo', parsed->>'serialNo'),
      coalesce(lookup_payload->>'productResourceCode', parsed->>'productResourceCode'),
      lookup_payload->>'packageLevel',
      lookup_payload->>'codeStatus',
      'in_stock',
      lookup_payload->>'externalSource',
      lookup_payload,
      auth.uid()
    )
    returning id into trace_code_id;
  end if;

  insert into public.inventory_movements (
    medicine_id, batch_id, batch_number, movement_type,
    quantity, balance, note, created_by
  )
  values (
    target_medicine.id,
    target_batch.id,
    target_batch.batch_number,
    'in',
    qty,
    target_batch.quantity,
    concat_ws(' - ', '扫码确认入库', coalesce(raw_code, v_trace_code)),
    auth.uid()
  );

  medicine_id := target_medicine.id;
  batch_id := target_batch.id;
  batch_balance := target_batch.quantity;
  message := case when created_medicine then '已创建药品主档并入库。' else '已匹配本地药品主档并入库。' end;
  return next;
end;
$$;

alter table public.medicine_code_mappings enable row level security;
alter table public.trace_codes enable row level security;
alter table public.drug_lookup_logs enable row level security;

drop policy if exists medicine_code_mappings_read on public.medicine_code_mappings;
create policy medicine_code_mappings_read on public.medicine_code_mappings
for select to authenticated
using (public.has_clinic_permission('alerts.view') or public.has_clinic_permission('transactions.view') or public.has_clinic_permission('stock.in'));

drop policy if exists medicine_code_mappings_admin_write on public.medicine_code_mappings;
create policy medicine_code_mappings_admin_write on public.medicine_code_mappings
for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists trace_codes_read on public.trace_codes;
create policy trace_codes_read on public.trace_codes
for select to authenticated
using (public.has_clinic_permission('stock.in') or public.has_clinic_permission('transactions.view'));

drop policy if exists trace_codes_admin_write on public.trace_codes;
create policy trace_codes_admin_write on public.trace_codes
for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists drug_lookup_logs_admin_read on public.drug_lookup_logs;
create policy drug_lookup_logs_admin_read on public.drug_lookup_logs
for select to authenticated
using (public.current_profile_role() = 'admin');

drop policy if exists drug_lookup_logs_insert on public.drug_lookup_logs;
create policy drug_lookup_logs_insert on public.drug_lookup_logs
for insert to authenticated
with check (auth.uid() is not null);

grant select, insert, update, delete on public.medicine_code_mappings to authenticated;
grant select, insert, update, delete on public.trace_codes to authenticated;
grant select, insert on public.drug_lookup_logs to authenticated;
grant execute on function public.parse_trace_payload(text) to authenticated;
grant execute on function public.rpc_trace_code_status(text) to authenticated;
grant execute on function public.rpc_trace_inbound(jsonb) to authenticated;
