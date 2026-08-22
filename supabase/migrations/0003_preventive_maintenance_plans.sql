-- MotoristaPro: planos de manutenção preventiva configuráveis por veículo

create table if not exists public.preventive_maintenance_plans (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  interval_km integer,
  interval_days integer,
  warning_km integer,
  warning_days integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (interval_km is null or interval_km > 0),
  check (interval_days is null or interval_days > 0),
  check (warning_km is null or warning_km >= 0),
  check (warning_days is null or warning_days >= 0),
  check (interval_km is not null or interval_days is not null)
);

create index if not exists idx_preventive_plans_user
  on public.preventive_maintenance_plans(user_id);
create index if not exists idx_preventive_plans_vehicle
  on public.preventive_maintenance_plans(vehicle_id);
create index if not exists idx_preventive_plans_user_vehicle
  on public.preventive_maintenance_plans(user_id, vehicle_id);

alter table public.preventive_maintenance_plans enable row level security;

create policy "preventive_plans_select_own" on public.preventive_maintenance_plans
  for select using (auth.uid() = user_id);

create policy "preventive_plans_insert_own" on public.preventive_maintenance_plans
  for insert with check (auth.uid() = user_id);

create policy "preventive_plans_update_own" on public.preventive_maintenance_plans
  for update using (auth.uid() = user_id);

create policy "preventive_plans_delete_own" on public.preventive_maintenance_plans
  for delete using (auth.uid() = user_id);

create or replace function public.check_preventive_plan_vehicle_ownership()
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

create trigger trg_preventive_plans_vehicle_ownership
  before insert or update on public.preventive_maintenance_plans
  for each row execute function public.check_preventive_plan_vehicle_ownership();
