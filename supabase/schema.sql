-- =============================================================================
-- Time Code — نظام ربط المشتريات بالمالية
-- شغّل الملف ده مرة واحدة في Supabase:  SQL Editor  ←  New query  ←  الصق  ←  Run
-- آمن لإعادة التشغيل (idempotent)
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------- المستخدمين
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'pending'
              check (role in ('pending','procurement','finance','management','disabled')),
  created_at  timestamptz not null default now()
);

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('procurement','finance','management'), false)
$$;

-- أول مستخدم يتسجل بياخد صلاحية المالية (مدير النظام)، والباقي "بانتظار التفعيل"
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, lower(new.email),
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles where role = 'finance') then 'pending' else 'finance' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- محدش يغيّر دوره بنفسه — المالية بس
create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and coalesce(public.my_role(), '') <> 'finance' then
    raise exception 'ليس لديك صلاحية لتغيير الأدوار';
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles
  for each row execute function public.protect_role();

-- ----------------------------------------------------------------------------- الإعدادات
create table if not exists public.cost_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.cost_categories (name, sort) values
  ('مواد', 1), ('عمالة', 2), ('معدات', 3), ('نقل', 4), ('مقاولين باطن', 5), ('أخرى', 6)
on conflict (name) do nothing;

create table if not exists public.app_settings (
  key    text primary key,
  value  text
);
insert into public.app_settings (key, value) values ('vat_rate', '15') on conflict (key) do nothing;

-- ----------------------------------------------------------------------------- المشاريع
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  code        text,
  name        text not null,
  client      text,
  location    text,
  start_date  date,
  status      text not null default 'active' check (status in ('active','on_hold','completed')),
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

-- العرض المالي التقديري (لكل بند)
create table if not exists public.budget_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  category_id  uuid references public.cost_categories(id) on delete set null,
  description  text,
  amount       numeric(14,2) not null default 0 check (amount >= 0),
  created_at   timestamptz not null default now()
);
create index if not exists budget_items_project_idx on public.budget_items(project_id);

-- تعديلات الميزانية (زيادة / تخفيض / تحويل) — العرض التقديري الأصلي بيفضل ثابت للمقارنة الأمينة
create table if not exists public.budget_revisions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  category_id  uuid references public.cost_categories(id) on delete set null,
  amount       numeric(14,2) not null check (amount <> 0),
  reason       text not null,
  created_by   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists budget_revisions_project_idx on public.budget_revisions(project_id);

-- ----------------------------------------------------------------------------- الفواتير وعروض الأسعار
create table if not exists public.documents (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  doc_type           text not null check (doc_type in ('tax_invoice','quotation')),
  supplier_name      text not null,
  supplier_vat       text,
  doc_number         text,
  doc_date           date,
  category_id        uuid references public.cost_categories(id) on delete set null,
  description        text,
  net_amount         numeric(14,2) not null check (net_amount >= 0),
  vat_amount         numeric(14,2) not null default 0 check (vat_amount >= 0),
  total_amount       numeric(14,2) not null check (total_amount >= 0),
  requested_percent  numeric(5,2) not null default 100 check (requested_percent > 0 and requested_percent <= 100),
  due_date           date,
  notes              text,
  review_status      text not null default 'new' check (review_status in ('new','clarification','approved','rejected')),
  review_note        text,
  reviewed_by        uuid references public.profiles(id) on delete set null,
  reviewed_at        timestamptz,
  -- الفاتورة الضريبية اللي بتترفع بعد سداد عرض السعر (قيمتها بتحل محل قيمة العرض)
  ti_number          text,
  ti_date            date,
  ti_net             numeric(14,2),
  ti_vat             numeric(14,2),
  ti_total           numeric(14,2),
  ti_uploaded_at     timestamptz,
  created_by         uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now()
);
create index if not exists documents_project_idx on public.documents(project_id);

-- الإصدار 2: آيبان المورد، المحتجزات (ضمان حسن التنفيذ)
alter table public.documents add column if not exists supplier_iban text;
alter table public.documents add column if not exists retention_percent numeric(5,2) not null default 0;
alter table public.documents add column if not exists retention_released_at timestamptz;
do $$ begin
  alter table public.documents add constraint documents_retention_chk check (retention_percent >= 0 and retention_percent <= 50);
exception when duplicate_object then null; end $$;
create index if not exists documents_supplier_idx on public.documents(lower(supplier_name), doc_number);

-- ----------------------------------------------------------------------------- الفواتير الضريبية المرتبطة بعروض الأسعار
-- كل دفعة مقدمة نقطة استحقاق ضريبي (ZATCA): المورد يصدر فاتورة ضريبية عن الدفعة، والفاتورة النهائية بتخصم الدفعات السابقة
create table if not exists public.tax_invoices (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  ti_number     text not null,
  ti_date       date not null,
  net_amount    numeric(14,2) not null check (net_amount >= 0),
  vat_amount    numeric(14,2) not null default 0 check (vat_amount >= 0),
  total_amount  numeric(14,2) not null check (total_amount >= 0),
  is_final      boolean not null default false,
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists tax_invoices_document_idx on public.tax_invoices(document_id);

-- ----------------------------------------------------------------------------- الدفعات
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  amount       numeric(14,2) not null check (amount > 0),
  pay_date     date not null default current_date,
  method       text,
  reference    text,
  notes        text,
  created_by   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists payments_document_idx on public.payments(document_id);
create index if not exists payments_project_idx on public.payments(project_id);

-- ----------------------------------------------------------------------------- المرفقات
create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  document_id  uuid references public.documents(id) on delete cascade,
  payment_id   uuid references public.payments(id) on delete cascade,
  kind         text not null check (kind in ('document','receipt','tax_invoice','budget')),
  path         text not null,
  file_name    text,
  mime         text,
  size         bigint,
  uploaded_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists attachments_project_idx on public.attachments(project_id);
alter table public.attachments add column if not exists tax_invoice_id uuid references public.tax_invoices(id) on delete cascade;
create index if not exists attachments_document_idx on public.attachments(document_id);

-- ----------------------------------------------------------------------------- الإشعارات والسجل
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  body          text,
  link          text,
  project_id    uuid,
  document_id   uuid,
  is_read       boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, is_read);

create table if not exists public.activity_log (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid,
  document_id  uuid,
  action       text not null,
  details      text,
  user_id      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

-- سجل تدقيق غير قابل للتعديل أو الحذف: كل تغيير بقيمته قبل وبعد (بيكتبه trigger مش العميل)
create table if not exists public.audit_log (
  id          bigserial primary key,
  table_name  text not null,
  record_id   uuid,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  user_id     uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_record_idx on public.audit_log(record_id);

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, user_id)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid()
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['projects','budget_items','budget_revisions','documents','tax_invoices','payments','attachments','profiles'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- =============================================================================
-- الصلاحيات (Row Level Security)
-- =============================================================================
alter table public.audit_log        enable row level security;
alter table public.budget_revisions enable row level security;
alter table public.profiles        enable row level security;
alter table public.cost_categories enable row level security;
alter table public.app_settings    enable row level security;
alter table public.projects        enable row level security;
alter table public.budget_items    enable row level security;
alter table public.documents       enable row level security;
alter table public.payments        enable row level security;
alter table public.attachments     enable row level security;
alter table public.notifications   enable row level security;
alter table public.activity_log    enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active() or id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.my_role() = 'finance');

-- cost_categories / app_settings: الكل يقرأ، المالية تعدل
drop policy if exists cat_select on public.cost_categories;
create policy cat_select on public.cost_categories for select to authenticated using (public.is_active());
drop policy if exists cat_write on public.cost_categories;
create policy cat_write on public.cost_categories for all to authenticated
  using (public.my_role() = 'finance') with check (public.my_role() = 'finance');

drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (public.is_active());
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for all to authenticated
  using (public.my_role() = 'finance') with check (public.my_role() = 'finance');

-- projects: المشتريات والمالية ينشئوا ويعدلوا، المالية بس تحذف
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (public.is_active());
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (public.my_role() in ('procurement','finance'));
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
  using (public.my_role() in ('procurement','finance'));
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated using (public.my_role() = 'finance');

-- budget_items: المالية بس
drop policy if exists budget_select on public.budget_items;
create policy budget_select on public.budget_items for select to authenticated using (public.is_active());
drop policy if exists budget_write on public.budget_items;
create policy budget_write on public.budget_items for all to authenticated
  using (public.my_role() = 'finance') with check (public.my_role() = 'finance');

-- budget_revisions: المالية تضيف فقط — لا تعديل ولا حذف
drop policy if exists revisions_select on public.budget_revisions;
create policy revisions_select on public.budget_revisions for select to authenticated using (public.is_active());
drop policy if exists revisions_insert on public.budget_revisions;
create policy revisions_insert on public.budget_revisions for insert to authenticated
  with check (public.my_role() = 'finance');

-- audit_log: قراءة للمالية والإدارة فقط، ومحدش يكتب أو يعدل أو يحذف من العميل
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.my_role() in ('finance','management'));

-- documents
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated using (public.is_active());
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (public.my_role() in ('procurement','finance'));
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (public.my_role() in ('procurement','finance'));
-- حفظ السجلات (6 سنوات على الأقل): المستند اللي عليه دفعات ممنوع حذفه
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (
    not exists (select 1 from public.payments p where p.document_id = documents.id)
    and (public.my_role() = 'finance' or (created_by = auth.uid() and review_status = 'new'))
  );

-- tax_invoices: المشتريات والمالية يضيفوا، المالية بس تعدل أو تحذف
alter table public.tax_invoices enable row level security;
drop policy if exists ti_select on public.tax_invoices;
create policy ti_select on public.tax_invoices for select to authenticated using (public.is_active());
drop policy if exists ti_insert on public.tax_invoices;
create policy ti_insert on public.tax_invoices for insert to authenticated
  with check (public.my_role() in ('procurement','finance'));
drop policy if exists ti_update on public.tax_invoices;
create policy ti_update on public.tax_invoices for update to authenticated using (public.my_role() = 'finance');
drop policy if exists ti_delete on public.tax_invoices;
create policy ti_delete on public.tax_invoices for delete to authenticated using (public.my_role() = 'finance');

-- المشتريات ما تقدرش تعتمد مستند بنفسها
create or replace function public.protect_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(public.my_role(), '') <> 'finance' then
    if (tg_op = 'INSERT' and new.review_status <> 'new')
       or (tg_op = 'UPDATE' and new.review_status is distinct from old.review_status and new.review_status <> 'new') then
      raise exception 'اعتماد ورفض الطلبات للمالية فقط';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists documents_protect_review on public.documents;
create trigger documents_protect_review before insert or update on public.documents
  for each row execute function public.protect_review();

-- حماية السداد على مستوى قاعدة البيانات: ممنوع السداد قبل الاعتماد أو بأكثر من قيمة المستند
create or replace function public.check_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d       public.documents%rowtype;
  paid    numeric;
  total   numeric;
  ti_sum  numeric;
begin
  select * into d from public.documents where id = new.document_id for update;
  if not found then raise exception 'المستند غير موجود'; end if;
  if d.review_status <> 'approved' then raise exception 'لا يمكن تسجيل دفعة قبل اعتماد المستند'; end if;
  new.project_id := d.project_id;
  -- لو وصلت الفاتورة النهائية، القيمة = مجموع الفواتير الضريبية؛ غير كده قيمة المستند
  select case when bool_or(is_final) then sum(total_amount) end into ti_sum from public.tax_invoices where document_id = d.id;
  total := coalesce(ti_sum, d.total_amount);
  select coalesce(sum(amount), 0) into paid from public.payments where document_id = new.document_id and id <> new.id;
  if paid + new.amount > total + 0.01 then
    raise exception 'مبلغ الدفعة أكبر من المتبقي على المستند (المتبقي % ر.س)', round(total - paid, 2);
  end if;
  return new;
end $$;
drop trigger if exists payments_check on public.payments;
create trigger payments_check before insert or update on public.payments
  for each row execute function public.check_payment();

-- payments: المالية بس
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using (public.is_active());
drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments for all to authenticated
  using (public.my_role() = 'finance') with check (public.my_role() = 'finance');

-- attachments
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated using (public.is_active());
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert to authenticated
  with check (public.my_role() in ('procurement','finance'));
drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments for delete to authenticated
  using (public.my_role() = 'finance' or uploaded_by = auth.uid());

-- notifications: كل واحد يشوف إشعاراته بس
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (recipient_id = auth.uid());
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated with check (public.is_active());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated using (recipient_id = auth.uid());
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using (recipient_id = auth.uid());

-- activity_log
drop policy if exists log_select on public.activity_log;
create policy log_select on public.activity_log for select to authenticated using (public.is_active());
drop policy if exists log_insert on public.activity_log;
create policy log_insert on public.activity_log for insert to authenticated with check (public.is_active());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- =============================================================================
-- إدارة المستخدمين (المالية = مدير النظام)
-- =============================================================================

-- داخلية: إنشاء حساب دخول مؤكد بكلمة مرور (مش متاحة للعميل مباشرة)
create or replace function public._create_auth_user(p_email text, p_password text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  uid uuid := gen_random_uuid();
  em  text := lower(trim(p_email));
begin
  if em is null or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'البريد الإلكتروني غير صحيح'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'كلمة المرور يجب ألا تقل عن 6 أحرف'; end if;
  if exists (select 1 from auth.users where lower(email) = em) then raise exception 'هذا البريد مسجل بالفعل'; end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', p_full_name), now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
          'email', now(), now(), now());

  update public.profiles set full_name = coalesce(nullif(trim(p_full_name), ''), full_name), email = em where id = uid;
  return uid;
end $$;
revoke all on function public._create_auth_user(text, text, text) from public, anon, authenticated;

-- هل النظام محتاج إعداد أول مدير؟
create or replace function public.app_needs_setup() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where role = 'finance')
$$;

-- إنشاء أول مدير (يشتغل مرة واحدة بس — لما مفيش أي مستخدم مالية)
create or replace function public.bootstrap_admin(p_email text, p_password text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if exists (select 1 from public.profiles where role = 'finance') then
    raise exception 'تم إعداد مدير النظام بالفعل — سجّل الدخول';
  end if;
  uid := public._create_auth_user(p_email, p_password, p_full_name);
  update public.profiles set role = 'finance' where id = uid;
  return uid;
end $$;

create or replace function public.admin_create_user(p_email text, p_password text, p_full_name text, p_role text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if coalesce(public.my_role(), '') <> 'finance' then raise exception 'ليس لديك صلاحية لإدارة المستخدمين'; end if;
  if p_role not in ('procurement','finance','management') then raise exception 'دور غير صحيح'; end if;
  uid := public._create_auth_user(p_email, p_password, p_full_name);
  update public.profiles set role = p_role where id = uid;
  return uid;
end $$;

create or replace function public.admin_update_user(p_user_id uuid, p_full_name text, p_email text, p_role text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare em text := lower(trim(p_email));
begin
  if coalesce(public.my_role(), '') <> 'finance' then raise exception 'ليس لديك صلاحية لإدارة المستخدمين'; end if;
  if p_role not in ('pending','procurement','finance','management','disabled') then raise exception 'دور غير صحيح'; end if;
  if p_user_id = auth.uid() and p_role <> 'finance' then raise exception 'لا يمكنك إزالة صلاحية المدير عن نفسك'; end if;
  if em is null or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'البريد الإلكتروني غير صحيح'; end if;
  if exists (select 1 from auth.users where lower(email) = em and id <> p_user_id) then raise exception 'هذا البريد مسجل بالفعل'; end if;

  update auth.users
     set email = em,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', p_full_name),
         banned_until = case when p_role = 'disabled' then 'infinity'::timestamptz else null end,
         updated_at = now()
   where id = p_user_id;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', em), updated_at = now()
   where user_id = p_user_id and provider = 'email';
  update public.profiles set full_name = p_full_name, email = em, role = p_role where id = p_user_id;
end $$;

create or replace function public.admin_set_password(p_user_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if coalesce(public.my_role(), '') <> 'finance' then raise exception 'ليس لديك صلاحية لإدارة المستخدمين'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'كلمة المرور يجب ألا تقل عن 6 أحرف'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user_id;
end $$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if coalesce(public.my_role(), '') <> 'finance' then raise exception 'ليس لديك صلاحية لإدارة المستخدمين'; end if;
  if p_user_id = auth.uid() then raise exception 'لا يمكنك حذف حسابك'; end if;
  delete from auth.users where id = p_user_id;
end $$;

revoke all on function public.bootstrap_admin(text, text, text) from public;
revoke all on function public.admin_create_user(text, text, text, text) from public, anon;
revoke all on function public.admin_update_user(uuid, text, text, text) from public, anon;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.app_needs_setup() to anon, authenticated;
grant execute on function public.bootstrap_admin(text, text, text) to anon, authenticated;
grant execute on function public.admin_create_user(text, text, text, text) to authenticated;
grant execute on function public.admin_update_user(uuid, text, text, text) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- =============================================================================
-- تخزين الملفات (صور الفواتير والإيصالات) — خاص، بروابط مؤقتة
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "tc files read" on storage.objects;
create policy "tc files read" on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.is_active());
drop policy if exists "tc files insert" on storage.objects;
create policy "tc files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.my_role() in ('procurement','finance'));
drop policy if exists "tc files delete" on storage.objects;
create policy "tc files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (public.my_role() = 'finance' or owner = auth.uid()));

-- =============================================================================
-- الإشعارات اللحظية
-- =============================================================================
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;
