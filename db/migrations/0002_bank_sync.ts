export const name = '0002_bank_sync';

/**
 * Підключення банку й довантаження виписок.
 *
 * Три речі, заради яких ця міграція існує:
 *
 * 1. `external_id` — ідентифікатор операції в банку. Саме він, а не збіг
 *    змісту, захищає від дублів: вебхук і довантаження можуть принести ту
 *    саму операцію, і часткові унікальні індекси зроблять другу вставку
 *    безпечною помилкою замість тихого роздвоєння балансу.
 *
 * 2. `bank_connections` — токен доступу до банку. Лежить зашифрованим
 *    (AES-GCM, ключ виводиться з AUTH_SECRET) і ніколи не віддається
 *    клієнту. `webhook_secret` — шлях, за яким банк стукає до нас.
 *
 * 3. `sync_windows` — журнал вікон довантаження. Банк дозволяє один запит
 *    на 60 секунд і не більше 31 дня за раз, тож історія тягнеться
 *    частинами. Журнал робить це відновлюваним: застосунок можна закрити
 *    посеред процесу й продовжити потім з того самого місця.
 */

export const sql = String.raw`
-- ─── Зовнішні ідентифікатори ──────────────────────────────────────────────

alter table accounts     add column if not exists external_id text;
alter table transactions add column if not exists external_id text;

-- Часткові індекси: власні, створені вручну записи лишаються з NULL і
-- не конкурують між собою за унікальність.
create unique index if not exists accounts_external_unique
  on accounts (user_id, external_id) where external_id is not null;

create unique index if not exists transactions_external_unique
  on transactions (user_id, external_id) where external_id is not null;

-- ─── Підключення банку ────────────────────────────────────────────────────

create table if not exists bank_connections (
  user_id        uuid not null references users (id) on delete cascade,
  provider       text not null check (provider in ('monobank')),
  token_cipher   text not null,
  client_id      text,
  client_name    text,
  webhook_secret text not null unique,
  webhook_state  text not null default 'pending'
                 check (webhook_state in ('pending', 'active', 'failed', 'off')),
  connected_at   timestamptz not null default now(),
  last_sync_at   timestamptz,
  last_error     text,
  primary key (user_id, provider)
);

-- ─── Вікна довантаження ───────────────────────────────────────────────────

create table if not exists sync_windows (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  account_id   uuid not null references accounts (id) on delete cascade,
  from_date    date not null,
  to_date      date not null,
  status       text not null default 'pending'
               check (status in ('pending', 'done', 'failed')),
  fetched      integer not null default 0,
  inserted     integer not null default 0,
  attempts     integer not null default 0,
  attempted_at timestamptz,
  completed_at timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  check (from_date <= to_date),
  unique (account_id, from_date, to_date)
);

-- Наступне вікно до обробки шукається саме цим індексом.
create index if not exists sync_windows_pending
  on sync_windows (user_id, status, from_date desc);

-- ─── RLS ──────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['bank_connections', 'sync_windows'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_owner') then
      execute format(
        'create policy %I on %I using (user_id = app_current_user_id())
           with check (user_id = app_current_user_id())',
        t || '_owner', t
      );
    end if;
  end loop;
end;
$$;

grant select, insert, update, delete on bank_connections, sync_windows to app_rls;
`;
