-- MotoristaPro: turnos de trabalho para métricas de horas e km

create table if not exists public.work_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_odometer_km integer,
  end_odometer_km integer,
  created_at timestamptz not null default now(),
  check (start_odometer_km is null or start_odometer_km >= 0),
  check (end_odometer_km is null or end_odometer_km >= 0),
  check (
    start_odometer_km is null or end_odometer_km is null or end_odometer_km >= start_odometer_km
  )
);

create index if not exists idx_work_sessions_user_started
  on public.work_sessions(user_id, started_at desc);

alter table public.work_sessions enable row level security;

create policy "work_sessions_select_own" on public.work_sessions
  for select using (auth.uid() = user_id);

create policy "work_sessions_insert_own" on public.work_sessions
  for insert with check (auth.uid() = user_id);

create policy "work_sessions_update_own" on public.work_sessions
  for update using (auth.uid() = user_id);

create policy "work_sessions_delete_own" on public.work_sessions
  for delete using (auth.uid() = user_id);

create or replace function public.check_work_session_vehicle_ownership()
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

create trigger trg_work_sessions_vehicle_ownership
  before insert or update on public.work_sessions
  for each row execute function public.check_work_session_vehicle_ownership();
