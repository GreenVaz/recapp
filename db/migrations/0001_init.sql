-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ Personal Finance Tracker — початкова схема                           ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Принципи:
--
--  1. Усі грошові величини — NUMERIC(18,2). Жодного float.
--
--  2. Поточний баланс рахунку НЕ зберігається колонкою. Він є чистою
--     функцією від initial_balance та проведених транзакцій (view
--     account_balances). Саме це гарантує вимогу ТЗ «фактичний платіж
--     впливає на баланс рівно один раз»: подвоїти вплив неможливо, бо
--     немає лічильника, який можна інкрементувати двічі.
--
--  3. Коригування залишку — це теж транзакція (kind='adjustment') зі
--     знаковою сумою. Історія завжди пояснює поточний баланс.
--
--  4. Захист від дублювання реалізований унікальними індексами, а не
--     перевірками в коді:
--       - одне матеріалізоване повторення на (правило, дата)
--       - один плановий платіж на рядок графіка кредиту
--       - одна транзакція на платіж по кредиту
--
--  5. RLS увімкнено скрізь. Політики читають current_setting('app.user_id'),
--     який API виставляє через set_config() у межах кожної транзакції.

-- gen_random_uuid() входить у ядро PostgreSQL з версії 13 — розширення
-- pgcrypto не потрібне. Хешування паролів робить застосунок (PBKDF2), а не БД.

-- ─── Автентифікація ───────────────────────────────────────────────────────
-- Відповідає парі auth.users + public.profiles у Supabase: якщо колись
-- переїдемо на Supabase Auth, таблиця users прибирається, а profiles
-- починає посилатися на auth.users.

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  password_hash text not null,
  -- Інкремент інвалідує всі видані JWT (вихід з усіх пристроїв, зміна пароля).
  token_version integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table profiles (
  user_id      uuid primary key references users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table password_reset_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index password_reset_tokens_user_idx on password_reset_tokens (user_id);

-- ─── Налаштування та курси ────────────────────────────────────────────────

create table user_settings (
  user_id       uuid primary key references users (id) on delete cascade,
  base_currency char(3) not null default 'UAH',
  theme         text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  locale        text not null default 'uk-UA',
  week_start    smallint not null default 1 check (week_start between 0 and 6),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table exchange_rates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  base       char(3) not null,
  quote      char(3) not null,
  -- Скільки одиниць quote за 1 одиницю base.
  rate       numeric(18, 8) not null check (rate > 0),
  updated_at timestamptz not null default now(),
  constraint exchange_rates_pair_key unique (user_id, base, quote),
  constraint exchange_rates_distinct check (base <> quote)
);

-- ─── Рахунки ──────────────────────────────────────────────────────────────

create table accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users (id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 60),
  type            text not null default 'card'
                  check (type in ('card', 'bank', 'cash', 'savings', 'other')),
  currency        char(3) not null default 'UAH',
  initial_balance numeric(18, 2) not null default 0,
  color           text not null default '#2f6bff',
  icon            text not null default 'Wallet',
  is_archived     boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index accounts_user_idx on accounts (user_id, is_archived, sort_order);

-- ─── Категорії (дворівневі) ───────────────────────────────────────────────

create table categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  kind        text not null check (kind in ('income', 'expense')),
  parent_id   uuid references categories (id) on delete cascade,
  icon        text not null default 'Circle',
  color       text not null default '#8b8f9a',
  is_archived boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index categories_user_idx on categories (user_id, kind, parent_id, sort_order);

-- Рівно два рівні: підкатегорія не може мати власних дітей.
create or replace function categories_depth_guard() returns trigger as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from categories where id = new.parent_id and parent_id is not null) then
      raise exception 'Підтримується лише два рівні категорій';
    end if;
    if exists (select 1 from categories where parent_id = new.id) then
      raise exception 'Категорія має підкатегорії і не може стати підкатегорією';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger categories_depth_guard_trg
  before insert or update of parent_id on categories
  for each row execute function categories_depth_guard();

-- ─── Регулярні правила ────────────────────────────────────────────────────

create table recurring_rules (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users (id) on delete cascade,
  kind               text not null check (kind in ('income', 'expense', 'transfer')),
  account_id         uuid not null references accounts (id) on delete cascade,
  counter_account_id uuid references accounts (id) on delete set null,
  category_id        uuid references categories (id) on delete set null,
  amount             numeric(18, 2) not null check (amount > 0),
  currency           char(3) not null default 'UAH',
  note               text,
  freq               text not null check (freq in ('daily', 'weekly', 'monthly', 'yearly')),
  step               integer not null default 1 check (step between 1 and 365),
  anchor_date        date not null,
  end_date           date,
  max_occurrences    integer check (max_occurrences > 0),
  -- Що робити, коли в місяці немає потрібного числа (31 лютого):
  -- clamp → останній день місяця, skip → пропустити місяць.
  month_end_policy   text not null default 'clamp' check (month_end_policy in ('clamp', 'skip')),
  auto_post          boolean not null default false,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint recurring_transfer_target check (
    (kind = 'transfer' and counter_account_id is not null and counter_account_id <> account_id)
    or (kind <> 'transfer' and counter_account_id is null)
  )
);
create index recurring_rules_user_idx on recurring_rules (user_id, is_active, anchor_date);

-- Правка одного повторення серії.
create table recurring_exceptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users (id) on delete cascade,
  rule_id         uuid not null references recurring_rules (id) on delete cascade,
  occurrence_date date not null,
  action          text not null check (action in ('skip', 'move', 'override')),
  new_date        date,
  new_amount      numeric(18, 2) check (new_amount > 0),
  new_note        text,
  created_at      timestamptz not null default now(),
  constraint recurring_exceptions_unique unique (rule_id, occurrence_date),
  constraint recurring_exceptions_move_has_date check (action <> 'move' or new_date is not null)
);

-- ─── Кредити та розстрочки ────────────────────────────────────────────────

create table loans (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users (id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 80),
  lender           text,
  kind             text not null default 'loan' check (kind in
                   ('loan', 'credit_card', 'installment', 'pay_in_parts', 'personal', 'interest_free')),
  principal        numeric(18, 2) not null check (principal > 0),
  currency         char(3) not null default 'UAH',
  opened_on        date not null,
  term_months      integer check (term_months > 0),
  -- Ставку користувач вводить як річну або місячну; rate_annual — нормалізована.
  rate_input       numeric(9, 4) check (rate_input >= 0),
  rate_period      text check (rate_period in ('annual', 'monthly')),
  rate_annual      numeric(9, 4) check (rate_annual >= 0),
  schedule_type    text not null check (schedule_type in
                   ('annuity', 'differentiated', 'interest_free', 'fixed_equal', 'manual')),
  payment_day      integer check (payment_day between 1 and 31),
  first_payment_on date not null,
  payments_count   integer check (payments_count > 0),
  -- Коли користувач знає лише загальну суму до виплати.
  total_due        numeric(18, 2) check (total_due > 0),
  fee_fixed        numeric(18, 2) not null default 0 check (fee_fixed >= 0),
  fee_percent      numeric(9, 4) not null default 0 check (fee_percent >= 0),
  account_id       uuid references accounts (id) on delete set null,
  category_id      uuid references categories (id) on delete set null,
  note             text,
  is_closed        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index loans_user_idx on loans (user_id, is_closed);

create table loan_payment_schedules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  loan_id        uuid not null references loans (id) on delete cascade,
  seq            integer not null check (seq > 0),
  due_on         date not null,
  amount         numeric(18, 2) not null check (amount >= 0),
  principal_part numeric(18, 2) not null default 0 check (principal_part >= 0),
  interest_part  numeric(18, 2) not null default 0 check (interest_part >= 0),
  fee_part       numeric(18, 2) not null default 0 check (fee_part >= 0),
  -- Залишок основного боргу ПІСЛЯ цього платежу.
  balance_after  numeric(18, 2) not null default 0,
  status         text not null default 'pending'
                 check (status in ('pending', 'paid', 'partial', 'skipped')),
  created_at     timestamptz not null default now(),
  constraint loan_schedule_seq_unique unique (loan_id, seq)
);
create index loan_schedules_user_due_idx on loan_payment_schedules (user_id, due_on, status);
create index loan_schedules_loan_idx on loan_payment_schedules (loan_id, due_on);

-- ─── Транзакції ───────────────────────────────────────────────────────────

create table transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users (id) on delete cascade,
  account_id          uuid not null references accounts (id) on delete cascade,
  kind                text not null check (kind in ('income', 'expense', 'transfer', 'adjustment')),
  -- Додатна для income/expense/transfer; знакова дельта для adjustment.
  amount              numeric(18, 2) not null,
  currency            char(3) not null default 'UAH',
  occurred_on         date not null,
  status              text not null default 'posted' check (status in ('planned', 'posted')),
  category_id         uuid references categories (id) on delete set null,
  counter_account_id  uuid references accounts (id) on delete set null,
  -- Сума зарахування для крос-валютного переказу.
  counter_amount      numeric(18, 2) check (counter_amount > 0),
  note                text,
  tags                text[] not null default '{}',
  recurring_rule_id   uuid references recurring_rules (id) on delete set null,
  recurring_occurrence date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint transactions_amount_sign check (
    (kind = 'adjustment' and amount <> 0) or (kind <> 'adjustment' and amount > 0)
  ),
  constraint transactions_transfer_shape check (
    (kind = 'transfer' and counter_account_id is not null and counter_account_id <> account_id
       and category_id is null)
    or (kind <> 'transfer' and counter_account_id is null and counter_amount is null)
  ),
  -- Матеріалізоване повторення завжди знає, яку саме дату серії воно закриває.
  constraint transactions_recurrence_shape check (
    (recurring_rule_id is null and recurring_occurrence is null)
    or (recurring_rule_id is not null and recurring_occurrence is not null)
  )
);

create index transactions_user_date_idx on transactions (user_id, occurred_on desc);
create index transactions_account_date_idx on transactions (user_id, account_id, occurred_on desc);
create index transactions_category_idx on transactions (user_id, category_id, occurred_on desc);
create index transactions_status_idx on transactions (user_id, status, occurred_on);
create index transactions_counter_idx on transactions (counter_account_id) where counter_account_id is not null;

-- ❶ Серія не може породити два записи на ту саму дату.
create unique index transactions_recurrence_unique
  on transactions (recurring_rule_id, recurring_occurrence)
  where recurring_rule_id is not null;

-- ─── Платежі по кредитах ──────────────────────────────────────────────────

create table loan_payments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  loan_id        uuid not null references loans (id) on delete cascade,
  schedule_id    uuid references loan_payment_schedules (id) on delete set null,
  -- Рух грошей існує рівно в одному місці — у транзакції.
  transaction_id uuid references transactions (id) on delete set null,
  paid_on        date not null,
  amount         numeric(18, 2) not null check (amount > 0),
  principal_part numeric(18, 2) not null default 0 check (principal_part >= 0),
  interest_part  numeric(18, 2) not null default 0 check (interest_part >= 0),
  fee_part       numeric(18, 2) not null default 0 check (fee_part >= 0),
  kind           text not null default 'scheduled'
                 check (kind in ('scheduled', 'extra', 'partial')),
  early_strategy text check (early_strategy in ('reduce_term', 'reduce_payment')),
  note           text,
  created_at     timestamptz not null default now()
);
create index loan_payments_loan_idx on loan_payments (loan_id, paid_on);
create index loan_payments_user_idx on loan_payments (user_id, paid_on desc);

-- ❷ Рядок графіка закривається планово лише один раз.
create unique index loan_payments_schedule_unique
  on loan_payments (schedule_id)
  where schedule_id is not null and kind = 'scheduled';

-- ❸ Одна транзакція обслуговує не більше одного платежу.
create unique index loan_payments_transaction_unique
  on loan_payments (transaction_id)
  where transaction_id is not null;

-- ─── Поточні баланси ──────────────────────────────────────────────────────
-- Єдине джерело правди про «скільки грошей є зараз».

-- security_invoker: без нього view виконувався б з правами власника і
-- обходив RLS, показуючи чужі баланси.
create view account_balances with (security_invoker = true) as
select
  a.id   as account_id,
  a.user_id,
  a.currency,
  a.initial_balance
    + coalesce(out_flow.delta, 0)
    + coalesce(in_flow.delta, 0) as balance
from accounts a
left join lateral (
  select sum(
    case t.kind
      when 'income'     then t.amount
      when 'expense'    then -t.amount
      when 'adjustment' then t.amount
      when 'transfer'   then -t.amount
    end
  ) as delta
  from transactions t
  where t.account_id = a.id and t.status = 'posted'
) out_flow on true
left join lateral (
  select sum(coalesce(t.counter_amount, t.amount)) as delta
  from transactions t
  where t.counter_account_id = a.id
    and t.kind = 'transfer'
    and t.status = 'posted'
) in_flow on true;

-- ─── Row Level Security ───────────────────────────────────────────────────
-- API виставляє app.user_id через set_config() на початку кожної транзакції.
-- Ніякий запит без цього контексту не побачить і не змінить чужих даних.

create or replace function app_current_user_id() returns uuid as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$ language sql stable;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_settings', 'exchange_rates', 'accounts', 'categories',
    'recurring_rules', 'recurring_exceptions', 'loans', 'loan_payment_schedules',
    'transactions', 'loan_payments'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (user_id = app_current_user_id())
         with check (user_id = app_current_user_id())',
      t || '_owner', t
    );
  end loop;
end;
$$;

-- profiles і user_settings ключуються user_id напряму — політика вище
-- посилається на колонку user_id, яка в них є первинним ключем.

-- ─── Роль, під якою виконуються запити користувача ────────────────────────
--
-- Критично: суперюзери й ролі з BYPASSRLS ігнорують RLS, і навіть FORCE ROW
-- LEVEL SECURITY їх не стосується. І Neon, і локальний Postgres зазвичай
-- дають застосунку саме таку привілейовану роль — політики мовчки не діяли б.
--
-- Тому кожен запит від імені користувача виконується через SET LOCAL ROLE
-- app_rls: звичайна роль без BYPASSRLS, для якої політики обов'язкові.
-- Таблиці users і password_reset_tokens їй не видані взагалі — автентифікація
-- працює під роллю-власником окремо.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rls') then
    create role app_rls nologin noinherit nobypassrls;
  end if;
end;
$$;

grant usage on schema public to app_rls;

grant select, insert, update, delete on
  profiles, user_settings, exchange_rates, accounts, categories,
  recurring_rules, recurring_exceptions, loans, loan_payment_schedules,
  transactions, loan_payments
to app_rls;

grant select on account_balances to app_rls;
grant execute on function app_current_user_id() to app_rls;

-- Щоб роль-власник могла перемикатися на app_rls.
do $$
begin
  execute format('grant app_rls to %I', current_user);
exception
  when others then null; -- вже є членство або самопосилання
end;
$$;
