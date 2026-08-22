-- MotoristaPro: otimiza RLS e adiciona índices para FKs

create index if not exists idx_vehicles_user_id on public.vehicles(user_id);
create index if not exists idx_transactions_vehicle_id on public.transactions(vehicle_id);
create index if not exists idx_maintenance_user_id on public.maintenance_events(user_id);
create index if not exists idx_work_sessions_vehicle_id on public.work_sessions(vehicle_id);

alter policy "vehicles_select_own" on public.vehicles using ((select auth.uid()) = user_id);
alter policy "vehicles_insert_own" on public.vehicles with check ((select auth.uid()) = user_id);
alter policy "vehicles_update_own" on public.vehicles using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "vehicles_delete_own" on public.vehicles using ((select auth.uid()) = user_id);

alter policy "transactions_select_own" on public.transactions using ((select auth.uid()) = user_id);
alter policy "transactions_insert_own" on public.transactions with check ((select auth.uid()) = user_id);
alter policy "transactions_update_own" on public.transactions using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "transactions_delete_own" on public.transactions using ((select auth.uid()) = user_id);

alter policy "maintenance_select_own" on public.maintenance_events using ((select auth.uid()) = user_id);
alter policy "maintenance_insert_own" on public.maintenance_events with check ((select auth.uid()) = user_id);
alter policy "maintenance_update_own" on public.maintenance_events using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "maintenance_delete_own" on public.maintenance_events using ((select auth.uid()) = user_id);

alter policy "work_sessions_select_own" on public.work_sessions using ((select auth.uid()) = user_id);
alter policy "work_sessions_insert_own" on public.work_sessions with check ((select auth.uid()) = user_id);
alter policy "work_sessions_update_own" on public.work_sessions using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "work_sessions_delete_own" on public.work_sessions using ((select auth.uid()) = user_id);

alter policy "preventive_plans_select_own" on public.preventive_maintenance_plans using ((select auth.uid()) = user_id);
alter policy "preventive_plans_insert_own" on public.preventive_maintenance_plans with check ((select auth.uid()) = user_id);
alter policy "preventive_plans_update_own" on public.preventive_maintenance_plans using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "preventive_plans_delete_own" on public.preventive_maintenance_plans using ((select auth.uid()) = user_id);
