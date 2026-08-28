alter table public.vehicles
  add column if not exists is_archived boolean not null default false;

create index if not exists idx_vehicles_user_archived
  on public.vehicles (user_id, is_archived);

-- Um veículo arquivado nunca deve permanecer como padrão.
update public.vehicles
set is_default = false
where is_archived = true and is_default = true;

-- Preserva duplicidades históricas já existentes, mas impede novas duplicidades
-- (inclusive variações como ABC-1D23 / abc1d23) em inserts e mudanças de placa.
create or replace function public.prevent_duplicate_vehicle_plate()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized_plate text;
begin
  if new.plate is null or btrim(new.plate) = '' then
    return new;
  end if;

  normalized_plate := regexp_replace(upper(new.plate), '[^A-Z0-9]', '', 'g');

  if tg_op = 'UPDATE'
     and regexp_replace(upper(coalesce(old.plate, '')), '[^A-Z0-9]', '', 'g') = normalized_plate then
    return new;
  end if;

  if exists (
    select 1
    from public.vehicles v
    where v.user_id = new.user_id
      and v.id <> new.id
      and regexp_replace(upper(coalesce(v.plate, '')), '[^A-Z0-9]', '', 'g') = normalized_plate
  ) then
    raise exception 'Já existe um veículo com esta placa para o usuário.';
  end if;

  new.plate := normalized_plate;
  return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_vehicle_plate on public.vehicles;
create trigger trg_prevent_duplicate_vehicle_plate
before insert or update of plate on public.vehicles
for each row execute function public.prevent_duplicate_vehicle_plate();
