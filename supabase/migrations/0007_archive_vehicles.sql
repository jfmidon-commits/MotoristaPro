alter table public.vehicles
  add column if not exists is_archived boolean not null default false;

create index if not exists idx_vehicles_user_archived
  on public.vehicles (user_id, is_archived);

-- Um veículo arquivado nunca deve permanecer como padrão.
update public.vehicles
set is_default = false
where is_archived = true and is_default = true;
