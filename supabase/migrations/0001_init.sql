-- MotoristaPro: schema inicial + RLS
-- Rode isso no SQL Editor do Supabase (ou via supabase db push)

create extension if not exists "pgcrypto";

-- =========================
-- VEHICLES
-- =========================
create table if not exists public.vehicles (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  plate text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.vehicles enable row level security;

create policy "vehicles_select_own" on public.vehicles
  for select using (auth.uid() = user_id);

create policy "vehicles_insert_own" on public.vehicles
  for insert with check (auth.uid() = user_id);

create policy "vehicles_update_own" on public.vehicles
  for update using (auth.uid() = user_id);

create policy "vehicles_delete_own" on public.vehicles
  for delete using (auth.uid() = user_id);

-- =========================
-- TRANSACTIONS
-- =========================
create table if not exists public.transactions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  type text not null check (type in ('income', 'expense')),
  category text not null,
  amount integer not null check (amount >= 0), -- centavos
  description text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_user_id on public.transactions(user_id);
create index if not exists idx_transactions_occurred_at on public.transactions(occurred_at desc);

alter table public.transactions enable row level security;

create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);

create policy "transactions_insert_own" on public.transactions
  for insert with check (auth.uid() = user_id);

create policy "transactions_update_own" on public.transactions
  for update using (auth.uid() = user_id);

create policy "transactions_delete_own" on public.transactions
  for delete using (auth.uid() = user_id);

-- Trava de segurança extra: RLS por si só NÃO impede que um usuário grave
-- uma transação com user_id = ele mesmo mas vehicle_id de um veículo de
-- OUTRO usuário (o FK só garante que o veículo existe, não que é dele).
-- Esse trigger fecha essa brecha.
create or replace function public.check_vehicle_ownership()
returns trigger as $$
begin
  if new.vehicle_id is not null then
    if not exists (
      select 1 from public.vehicles
      where id = new.vehicle_id and user_id = new.user_id
    ) then
      raise exception 'vehicle_id não pertence ao usuário informado';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_transactions_vehicle_ownership
  before insert or update on public.transactions
  for each row execute function public.check_vehicle_ownership();

-- =========================
-- MAINTENANCE_EVENTS
-- =========================
create table if not exists public.maintenance_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  description text not null,
  cost integer not null check (cost >= 0),
  odometer_km integer,
  performed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_maintenance_vehicle_id on public.maintenance_events(vehicle_id);

alter table public.maintenance_events enable row level security;

create policy "maintenance_select_own" on public.maintenance_events
  for select using (auth.uid() = user_id);

create policy "maintenance_insert_own" on public.maintenance_events
  for insert with check (auth.uid() = user_id);

create policy "maintenance_update_own" on public.maintenance_events
  for update using (auth.uid() = user_id);

create policy "maintenance_delete_own" on public.maintenance_events
  for delete using (auth.uid() = user_id);

create or replace function public.check_maintenance_vehicle_ownership()
returns trigger as $$
begin
  if not exists (
    select 1 from public.vehicles
    where id = new.vehicle_id and user_id = new.user_id
  ) then
    raise exception 'vehicle_id não pertence ao usuário informado';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_maintenance_vehicle_ownership
  before insert or update on public.maintenance_events
  for each row execute function public.check_maintenance_vehicle_ownership();
