-- MotoristaPro: vincula manutenções realizadas a planos preventivos

alter table public.maintenance_events
  add column if not exists preventive_plan_id uuid
  references public.preventive_maintenance_plans(id)
  on delete set null;

-- Índice para lookups rápidos por plano
create index if not exists idx_maintenance_events_plan_id
  on public.maintenance_events(preventive_plan_id);

-- Nota: RLS já existe na tabela; a nova coluna herda as políticas existentes
-- pois não altera a lógica de ownership (user_id permanece o campo de controle).
