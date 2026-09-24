-- MotoristaPro: arquivamento lógico de veículos

alter table public.vehicles
  add column if not exists is_archived boolean not null default false;

create index if not exists idx_vehicles_user_archived
  on public.vehicles(user_id, is_archived);
