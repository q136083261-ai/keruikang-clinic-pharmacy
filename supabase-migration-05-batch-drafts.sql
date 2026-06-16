-- supabase-migration-05-batch-drafts.sql
-- Excel 批次参考资料表：只用于辅助录入，不等于真实库存。
-- 不写 inventory_batches，不写 trace_codes，不写 stock_movements。

create table if not exists public.medicine_batch_drafts (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid references public.medicines(id) on delete set null,
  internal_code text,
  name text,
  manufacturer text,
  batch_no text,
  production_date date,
  production_precision text,
  expiry_date date,
  expiry_precision text,
  quantity integer,
  unit text,
  retail_price numeric,
  review_notes text,
  source text default 'excel_import_review',
  used_for_inbound boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists medicine_batch_drafts_medicine_idx
  on public.medicine_batch_drafts(medicine_id);

create index if not exists medicine_batch_drafts_internal_code_idx
  on public.medicine_batch_drafts(internal_code);

create index if not exists medicine_batch_drafts_expiry_idx
  on public.medicine_batch_drafts(expiry_date desc nulls last);

create or replace function public.touch_medicine_batch_drafts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_medicine_batch_drafts_updated_at on public.medicine_batch_drafts;
create trigger touch_medicine_batch_drafts_updated_at
before update on public.medicine_batch_drafts
for each row execute function public.touch_medicine_batch_drafts_updated_at();

alter table public.medicine_batch_drafts enable row level security;

drop policy if exists medicine_batch_drafts_read on public.medicine_batch_drafts;
create policy medicine_batch_drafts_read on public.medicine_batch_drafts
for select to authenticated
using (
  public.has_clinic_permission('medicine.create')
  or public.has_clinic_permission('medicine.edit')
  or public.has_clinic_permission('stock.in')
  or public.current_profile_role() = 'admin'
);

drop policy if exists medicine_batch_drafts_admin_write on public.medicine_batch_drafts;
create policy medicine_batch_drafts_admin_write on public.medicine_batch_drafts
for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

grant select, insert, update, delete on public.medicine_batch_drafts to authenticated;

-- 导入 clinic_batches_need_review.csv 时，请使用 staging/SQL 将 internal_code 关联到 medicines.id 后写入本表。
-- 本表是参考草稿，不能直接用于库存统计。
