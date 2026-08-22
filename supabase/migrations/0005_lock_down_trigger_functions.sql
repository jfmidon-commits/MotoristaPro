-- MotoristaPro: restringe execução direta das funções de trigger e fixa search_path

revoke execute on function public.check_vehicle_ownership() from public, anon, authenticated;
revoke execute on function public.check_maintenance_vehicle_ownership() from public, anon, authenticated;
revoke execute on function public.check_work_session_vehicle_ownership() from public, anon, authenticated;
revoke execute on function public.check_preventive_plan_vehicle_ownership() from public, anon, authenticated;

alter function public.check_vehicle_ownership() set search_path = public, pg_temp;
alter function public.check_maintenance_vehicle_ownership() set search_path = public, pg_temp;
alter function public.check_work_session_vehicle_ownership() set search_path = public, pg_temp;
alter function public.check_preventive_plan_vehicle_ownership() set search_path = public, pg_temp;
