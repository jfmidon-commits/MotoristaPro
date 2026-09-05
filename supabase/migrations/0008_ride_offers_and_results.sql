-- MotoristaPro: ofertas de corrida, análise de decisão e resultado realizado

create table if not exists public.ride_offers (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  work_session_id uuid references public.work_sessions(id) on delete set null,
  platform text not null check (platform in ('uber','99','indrive','other')),
  category text,
  captured_at timestamptz not null,
  offered_amount integer not null check (offered_amount >= 0),
  pickup_distance_km numeric check (pickup_distance_km is null or pickup_distance_km >= 0),
  pickup_duration_minutes numeric check (pickup_duration_minutes is null or pickup_duration_minutes >= 0),
  trip_distance_km numeric check (trip_distance_km is null or trip_distance_km >= 0),
  trip_duration_minutes numeric check (trip_duration_minutes is null or trip_duration_minutes >= 0),
  total_expected_distance_km numeric check (total_expected_distance_km is null or total_expected_distance_km >= 0),
  total_expected_duration_minutes numeric check (total_expected_duration_minutes is null or total_expected_duration_minutes >= 0),
  approximate_origin_zone text,
  approximate_destination_zone text,
  additional_pay integer not null default 0 check (additional_pay >= 0),
  capture_source text not null,
  extraction_confidence numeric check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 1)),
  estimated_cost integer,
  expected_net_profit integer,
  expected_net_per_km integer,
  expected_net_per_hour integer,
  decision_label text check (decision_label is null or decision_label in ('good','borderline','bad')),
  decision_score integer check (decision_score is null or (decision_score >= 0 and decision_score <= 100)),
  decision_reasons_positive_json text,
  decision_reasons_negative_json text,
  decision_confidence numeric check (decision_confidence is null or (decision_confidence >= 0 and decision_confidence <= 1)),
  created_at timestamptz not null default now()
);

create table if not exists public.ride_results (
  id uuid primary key,
  ride_offer_id uuid not null references public.ride_offers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  final_amount integer not null check (final_amount >= 0),
  actual_distance_km numeric check (actual_distance_km is null or actual_distance_km >= 0),
  actual_duration_minutes numeric check (actual_duration_minutes is null or actual_duration_minutes >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  estimated_cost integer,
  net_profit integer,
  net_per_km integer,
  net_per_hour integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_ride_offers_user_captured on public.ride_offers(user_id, captured_at);
create index if not exists idx_ride_offers_vehicle on public.ride_offers(vehicle_id);
create index if not exists idx_ride_offers_work_session on public.ride_offers(work_session_id);
create index if not exists idx_ride_results_user on public.ride_results(user_id);
create index if not exists idx_ride_results_offer on public.ride_results(ride_offer_id);
create index if not exists idx_ride_results_vehicle on public.ride_results(vehicle_id);

alter table public.ride_offers enable row level security;
alter table public.ride_results enable row level security;

create policy "ride_offers_select_own" on public.ride_offers for select using ((select auth.uid()) = user_id);
create policy "ride_offers_insert_own" on public.ride_offers for insert with check ((select auth.uid()) = user_id);
create policy "ride_offers_update_own" on public.ride_offers for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "ride_offers_delete_own" on public.ride_offers for delete using ((select auth.uid()) = user_id);

create policy "ride_results_select_own" on public.ride_results for select using ((select auth.uid()) = user_id);
create policy "ride_results_insert_own" on public.ride_results for insert with check ((select auth.uid()) = user_id);
create policy "ride_results_update_own" on public.ride_results for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "ride_results_delete_own" on public.ride_results for delete using ((select auth.uid()) = user_id);

create or replace function public.check_ride_offer_ownership()
returns trigger as $$
begin
  if new.vehicle_id is not null and not exists (
    select 1 from public.vehicles where id = new.vehicle_id and user_id = new.user_id
  ) then
    raise exception 'vehicle_id não pertence ao usuário informado';
  end if;
  if new.work_session_id is not null and not exists (
    select 1 from public.work_sessions where id = new.work_session_id and user_id = new.user_id
  ) then
    raise exception 'work_session_id não pertence ao usuário informado';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create or replace function public.check_ride_result_ownership()
returns trigger as $$
begin
  if not exists (
    select 1 from public.ride_offers where id = new.ride_offer_id and user_id = new.user_id
  ) then
    raise exception 'ride_offer_id não pertence ao usuário informado';
  end if;
  if new.vehicle_id is not null and not exists (
    select 1 from public.vehicles where id = new.vehicle_id and user_id = new.user_id
  ) then
    raise exception 'vehicle_id não pertence ao usuário informado';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.check_ride_offer_ownership() from public, anon, authenticated;
revoke execute on function public.check_ride_result_ownership() from public, anon, authenticated;

create trigger trg_ride_offers_ownership
  before insert or update on public.ride_offers
  for each row execute function public.check_ride_offer_ownership();

create trigger trg_ride_results_ownership
  before insert or update on public.ride_results
  for each row execute function public.check_ride_result_ownership();
