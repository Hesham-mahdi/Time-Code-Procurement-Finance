'use strict';

// طبقة البيانات: نفس الواجهة لـ Supabase وللوضع التجريبي (المحلي)
const TABLES = ['profiles', 'cost_categories', 'app_settings', 'projects', 'budget_items', 'budget_revisions',
  'documents', 'tax_invoices', 'payments', 'attachments', 'notifications', 'activity_log'];
const AUDITED = ['projects', 'budget_items', 'budget_revisions', 'documents', 'tax_invoices', 'payments', 'attachments', 'profiles'];

function SupabaseBackend(cfg) {
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const bucket = cfg.STORAGE_BUCKET || 'files';
  const fail = (error) => { if (error) throw error; };
  const redirect = () => location.origin + location.pathname;

  return {
    mode: 'supabase',

    async getUser() {
      const { data } = await sb.auth.getSession();
      return data.session ? data.session.user : null;
    },
    onAuth(cb) {
      sb.auth.onAuthStateChange((event, session) => cb(event, session ? session.user : null));
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      fail(error);
    },
    async signUp(email, password, full_name) {
      const { data, error } = await sb.auth.signUp({
        email, password, options: { data: { full_name }, emailRedirectTo: redirect() },
      });
      fail(error);
      return { needsConfirm: !data.session };
    },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
      fail(error);
    },
    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      fail(error);
    },
    async signOut() { await sb.auth.signOut(); },

    async select(table) {
      const out = [];
      const page = 1000;
      for (let from = 0; ; from += page) {
        const { data, error } = await sb.from(table).select('*').range(from, from + page - 1);
        fail(error);
        out.push(...data);
        if (data.length < page) break;
      }
      return out;
    },
    async selectWhere(table, match, { order = 'created_at', asc = false, limit = 500 } = {}) {
      const { data, error } = await sb.from(table).select('*').match(match).order(order, { ascending: asc }).limit(limit);
      fail(error);
      return data;
    },
    async insert(table, rows) {
      const { data, error } = await sb.from(table).insert(rows).select();
      fail(error);
      return data;
    },
    async update(table, id, patch) {
      const { data, error } = await sb.from(table).update(patch).eq('id', id).select();
      fail(error);
      if (!data.length) throw new Error('permission denied');
      return data[0];
    },
    async updateWhere(table, match, patch) {
      const { error } = await sb.from(table).update(patch).match(match);
      fail(error);
    },
    async remove(table, id) {
      const { error } = await sb.from(table).delete().eq('id', id);
      fail(error);
    },
    async removeWhere(table, match) {
      const { error } = await sb.from(table).delete().match(match);
      fail(error);
    },
    async setSetting(key, value) {
      const { error } = await sb.from('app_settings').upsert({ key, value: String(value) });
      fail(error);
    },
    async rpc(fn, args = {}) {
      const { data, error } = await sb.rpc(fn, args);
      fail(error);
      return data;
    },

    async upload(file, path) {
      const { error } = await sb.storage.from(bucket).upload(path, file, {
        contentType: file.type || 'application/octet-stream', upsert: false,
      });
      fail(error);
    },
    async fileUrl(path) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
      fail(error);
      return data.signedUrl;
    },
    async removeFile(path) {
      await sb.storage.from(bucket).remove([path]);
    },

    subscribe(userId, cb) {
      const ch = sb.channel(`notif-${userId}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}`,
        }, (p) => cb(p.new))
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}

// ---------------------------------------------------------------------------
// الوضع التجريبي: كل البيانات في localStorage، وكل تبويب يقدر يدخل بمستخدم مختلف
// (افتح تبويبين: واحد مشتريات وواحد مالية — الإشعارات بتوصل بينهم)
// ---------------------------------------------------------------------------
function LocalBackend() {
  const KEY = 'tc_demo_db_v2';
  const FKEY = 'tc_demo_files_v1';
  const UKEY = 'tc_demo_user';
  const memFiles = new Map();
  let authCb = null;
  const subs = [];
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('tc_demo') : null;

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const userId = () => { try { return sessionStorage.getItem(UKEY); } catch (e) { return null; } };
  const setUser = (id) => { try { id ? sessionStorage.setItem(UKEY, id) : sessionStorage.removeItem(UKEY); } catch (e) { /* */ } };

  let db = read(KEY);
  if (!db || !db.profiles) { db = demoSeed(); write(KEY, db); }
  TABLES.forEach((t) => { db[t] = db[t] || []; });
  const save = () => write(KEY, db);
  const reload = () => {
    const d = read(KEY);
    if (d && d.profiles) { db = d; TABLES.forEach((t) => { db[t] = db[t] || []; }); db.audit_log = db.audit_log || []; }
  };

  const deliver = (n) => subs.filter((s) => s.userId === n.recipient_id).forEach((s) => s.cb(n));
  if (bc) bc.onmessage = (e) => { reload(); if (e.data && e.data.type === 'notif') deliver(e.data.row); };

  const matches = (row, match) => Object.entries(match).every(([k, v]) => row[k] === v);

  // محاكاة سجل التدقيق والتحقق من الدفعات الموجودين في قاعدة البيانات
  function audit(table, action, oldRow, newRow) {
    if (!AUDITED.includes(table)) return;
    if (!db.audit_log) db.audit_log = [];
    db.audit_log.push({ id: db.audit_log.length + 1, table_name: table, record_id: (newRow || oldRow).id, action, old_data: oldRow ? clone(oldRow) : null, new_data: newRow ? clone(newRow) : null, user_id: userId(), created_at: new Date().toISOString() });
  }
  function checkPayment(p) {
    const d = db.documents.find((x) => x.id === p.document_id);
    if (!d) throw new Error('المستند غير موجود');
    if (d.review_status !== 'approved') throw new Error('لا يمكن تسجيل دفعة قبل اعتماد المستند');
    const tis = db.tax_invoices.filter((t) => t.document_id === d.id);
    const total = tis.some((t) => t.is_final) ? tis.reduce((a, t) => a + Number(t.total_amount), 0) : Number(d.total_amount);
    const paid = db.payments.filter((x) => x.document_id === d.id).reduce((a, x) => a + Number(x.amount), 0);
    if (paid + Number(p.amount) > total + 0.01) throw new Error(`مبلغ الدفعة أكبر من المتبقي على المستند (المتبقي ${U.money(total - paid)} ر.س)`);
  }

  return {
    mode: 'demo',
    demoUsers: () => db.profiles.filter((p) => p.demo),

    async getUser() {
      const id = userId();
      const p = id && db.profiles.find((x) => x.id === id);
      return p ? { id: p.id, email: p.email } : null;
    },
    onAuth(cb) { authCb = cb; },
    async signIn(email, password) {
      reload();
      const p = db.profiles.find((x) => x.email === String(email).trim().toLowerCase());
      if (!p || (p.pw && p.pw !== password)) throw new Error('Invalid login credentials');
      if (p.role === 'disabled') throw new Error('User is banned');
      setUser(p.id);
      if (authCb) authCb('SIGNED_IN', { id: p.id, email: p.email });
    },
    async signUp(email, password, full_name) {
      reload();
      email = String(email).trim().toLowerCase();
      if (db.profiles.some((x) => x.email === email)) throw new Error('already registered');
      const p = { id: U.uuid(), email, full_name, role: 'pending', created_at: new Date().toISOString() };
      db.profiles.push(p);
      save();
      return { needsConfirm: false, autoLogin: () => this.signIn(email) };
    },
    async resetPassword() { /* لا يوجد بريد في الوضع التجريبي */ },
    async updatePassword() { /* */ },
    async signOut() {
      setUser(null);
      if (authCb) authCb('SIGNED_OUT', null);
    },

    async select(table) { reload(); return clone(db[table] || []); },
    async selectWhere(table, match, { order = 'created_at', asc = false, limit = 500 } = {}) {
      reload();
      const rows = (db[table] || []).filter((r) => matches(r, match));
      rows.sort((a, b) => String(a[order]).localeCompare(String(b[order])) * (asc ? 1 : -1));
      return clone(rows.slice(0, limit));
    },
    async insert(table, rows) {
      reload();
      const now = new Date().toISOString();
      const out = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: U.uuid(), created_at: now, ...r }));
      if (table === 'payments') out.forEach(checkPayment);
      db[table].push(...out);
      out.forEach((r) => audit(table, 'INSERT', null, r));
      save();
      if (table === 'notifications') {
        out.forEach((n) => { deliver(n); if (bc) bc.postMessage({ type: 'notif', row: n }); });
      }
      return clone(out);
    },
    async update(table, id, patch) {
      reload();
      const row = db[table].find((r) => r.id === id);
      if (!row) throw new Error('السجل غير موجود');
      const before = clone(row);
      Object.assign(row, patch);
      audit(table, 'UPDATE', before, row);
      save();
      return clone(row);
    },
    async updateWhere(table, match, patch) {
      reload();
      db[table].filter((r) => matches(r, match)).forEach((r) => Object.assign(r, patch));
      save();
    },
    async remove(table, id) {
      reload();
      const gone = db[table].find((r) => r.id === id);
      if (gone) audit(table, 'DELETE', gone, null);
      db[table] = db[table].filter((r) => r.id !== id);
      // حذف متتالي بسيط لمحاكاة on delete cascade
      if (table === 'projects') ['budget_items', 'documents', 'payments', 'attachments'].forEach((t) => { db[t] = db[t].filter((r) => r.project_id !== id); });
      if (table === 'documents') ['payments', 'attachments', 'tax_invoices'].forEach((t) => { db[t] = db[t].filter((r) => r.document_id !== id); });
      if (table === 'payments') db.attachments = db.attachments.filter((r) => r.payment_id !== id);
      if (table === 'tax_invoices') db.attachments = db.attachments.filter((r) => r.tax_invoice_id !== id);
      if (table === 'projects') ['budget_revisions', 'tax_invoices'].forEach((t) => { db[t] = db[t].filter((r) => r.project_id !== id); });
      save();
    },
    async removeWhere(table, match) {
      reload();
      db[table] = db[table].filter((r) => !matches(r, match));
      save();
    },
    async setSetting(key, value) {
      reload();
      const row = db.app_settings.find((r) => r.key === key);
      if (row) row.value = String(value); else db.app_settings.push({ key, value: String(value) });
      save();
    },
    // محاكاة دوال إدارة المستخدمين الموجودة في schema.sql
    async rpc(fn, a = {}) {
      reload();
      const me = db.profiles.find((p) => p.id === userId());
      const admin = () => { if (!me || me.role !== 'finance') throw new Error('ليس لديك صلاحية لإدارة المستخدمين'); };
      const email = (e) => {
        const em = String(e || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error('البريد الإلكتروني غير صحيح');
        return em;
      };
      const pw = (p) => { if (String(p || '').length < 6) throw new Error('كلمة المرور يجب ألا تقل عن 6 أحرف'); };
      const create = (role) => {
        const em = email(a.p_email);
        pw(a.p_password);
        if (db.profiles.some((p) => p.email === em)) throw new Error('هذا البريد مسجل بالفعل');
        const p = { id: U.uuid(), email: em, full_name: a.p_full_name, role, pw: a.p_password, created_at: new Date().toISOString() };
        db.profiles.push(p);
        save();
        return p.id;
      };
      switch (fn) {
        case 'app_needs_setup': return !db.profiles.some((p) => p.role === 'finance');
        case 'bootstrap_admin':
          if (db.profiles.some((p) => p.role === 'finance')) throw new Error('تم إعداد مدير النظام بالفعل — سجّل الدخول');
          return create('finance');
        case 'admin_create_user': admin(); return create(a.p_role);
        case 'admin_update_user': {
          admin();
          const em = email(a.p_email);
          if (a.p_user_id === me.id && a.p_role !== 'finance') throw new Error('لا يمكنك إزالة صلاحية المدير عن نفسك');
          if (db.profiles.some((p) => p.email === em && p.id !== a.p_user_id)) throw new Error('هذا البريد مسجل بالفعل');
          Object.assign(db.profiles.find((p) => p.id === a.p_user_id), { full_name: a.p_full_name, email: em, role: a.p_role });
          save();
          return null;
        }
        case 'admin_set_password':
          admin(); pw(a.p_password);
          db.profiles.find((p) => p.id === a.p_user_id).pw = a.p_password;
          save();
          return null;
        case 'admin_delete_user':
          admin();
          if (a.p_user_id === me.id) throw new Error('لا يمكنك حذف حسابك');
          db.profiles = db.profiles.filter((p) => p.id !== a.p_user_id);
          db.notifications = db.notifications.filter((n) => n.recipient_id !== a.p_user_id);
          save();
          return null;
        default: throw new Error(`unknown rpc ${fn}`);
      }
    },

    async upload(file, path) {
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      memFiles.set(path, dataUrl);
      const all = read(FKEY) || {};
      all[path] = dataUrl;
      write(FKEY, all); // لو المساحة امتلأت يفضل الملف في الذاكرة لحد تحديث الصفحة
    },
    async fileUrl(path) {
      const src = memFiles.get(path) || (read(FKEY) || {})[path] || DEMO_FILES[path];
      if (!src) throw new Error('الملف غير متاح في الوضع التجريبي (تم مسحه من ذاكرة المتصفح)');
      const blob = await (await fetch(src)).blob();
      return URL.createObjectURL(blob);
    },
    async removeFile(path) {
      memFiles.delete(path);
      const all = read(FKEY) || {};
      delete all[path];
      write(FKEY, all);
    },

    subscribe(uid, cb) {
      const s = { userId: uid, cb };
      subs.push(s);
      return () => subs.splice(subs.indexOf(s), 1);
    },

    resetDemo() {
      localStorage.removeItem(KEY);
      localStorage.removeItem(FKEY);
      setUser(null);
    },
  };
}

// صورة فاتورة توضيحية للبيانات التجريبية
const DEMO_FILES = (() => {
  const svg = (title, color) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
      <rect width="600" height="800" fill="#fff"/><rect width="600" height="110" fill="${color}"/>
      <text x="300" y="68" font-family="Arial" font-size="34" fill="#fff" text-anchor="middle">${title}</text>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="60" y="${170 + i * 70}" width="480" height="18" rx="4" fill="#e5e7eb"/>`).join('')}
      <rect x="320" y="640" width="220" height="60" rx="8" fill="#f3f4f6"/>
      <text x="300" y="770" font-family="Arial" font-size="18" fill="#9ca3af" text-anchor="middle">DEMO DOCUMENT</text>
    </svg>`);
  return {
    'demo/invoice.svg': svg('TAX INVOICE', '#16324f'),
    'demo/quote.svg': svg('QUOTATION', '#2a78d6'),
    'demo/receipt.svg': svg('PAYMENT RECEIPT', '#0f7b4f'),
  };
})();

function demoSeed() {
  const now = Date.now();
  const at = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
  const day = (daysAgo) => at(daysAgo).slice(0, 10);
  const fin = { id: 'u-fin', email: 'finance@demo.sa', full_name: 'هشام — المالية', role: 'finance', demo: true, created_at: at(60) };
  const pro = { id: 'u-pro', email: 'procurement@demo.sa', full_name: 'أحمد — مدير المشتريات', role: 'procurement', demo: true, created_at: at(60) };
  const mgt = { id: 'u-mgt', email: 'management@demo.sa', full_name: 'الإدارة العليا', role: 'management', demo: true, created_at: at(60) };
  const cats = ['مواد', 'عمالة', 'معدات', 'نقل', 'مقاولين باطن', 'أخرى']
    .map((name, i) => ({ id: `c-${i + 1}`, name, sort: i + 1, created_at: at(60) }));
  const p1 = { id: 'p-1', code: 'PRJ-001', name: 'مشروع النخيل', client: 'شركة النخيل العقارية', location: 'الرياض', start_date: day(45), status: 'active', notes: '', created_by: pro.id, created_at: at(45) };
  const p2 = { id: 'p-2', code: 'PRJ-002', name: 'مشروع وعد القصيم', client: 'وعد للتطوير', location: 'القصيم', start_date: day(20), status: 'active', notes: '', created_by: pro.id, created_at: at(20) };
  const budget = [
    ['p-1', 'c-1', 180000], ['p-1', 'c-2', 90000], ['p-1', 'c-3', 40000], ['p-1', 'c-4', 15000],
    ['p-2', 'c-1', 120000], ['p-2', 'c-2', 60000], ['p-2', 'c-5', 75000],
  ].map(([project_id, category_id, amount], i) => ({ id: `b-${i}`, project_id, category_id, amount, description: '', created_at: at(40) }));
  const doc = (o) => ({
    supplier_vat: '', doc_date: day(10), description: '', due_date: null, notes: '', review_note: '',
    reviewed_by: null, reviewed_at: null, supplier_iban: null, retention_percent: 0, retention_released_at: null,
    created_by: pro.id, ...o, vat_amount: U.round2(o.net_amount * 0.15), total_amount: U.round2(o.net_amount * 1.15),
  });
  const docs = [
    doc({ id: 'd-1', project_id: 'p-1', doc_type: 'tax_invoice', supplier_name: 'مؤسسة الحديد الوطني', supplier_vat: '300123456700003', supplier_iban: 'SA0380000000608010167519', doc_number: 'INV-5521', category_id: 'c-1', net_amount: 95000, requested_percent: 100, review_status: 'approved', reviewed_by: fin.id, reviewed_at: at(8), created_at: at(12), doc_date: day(12) }),
    doc({ id: 'd-2', project_id: 'p-1', doc_type: 'quotation', supplier_name: 'شركة المعدات الثقيلة', doc_number: 'Q-221', category_id: 'c-3', net_amount: 38000, requested_percent: 50, review_status: 'approved', reviewed_by: fin.id, reviewed_at: at(5), created_at: at(7), doc_date: day(7) }),
    doc({ id: 'd-3', project_id: 'p-1', doc_type: 'quotation', supplier_name: 'مصنع الخرسانة الجاهزة', doc_number: 'Q-87', category_id: 'c-1', net_amount: 92000, requested_percent: 30, review_status: 'new', created_at: at(1), doc_date: day(1) }),
    doc({ id: 'd-4', project_id: 'p-2', doc_type: 'tax_invoice', supplier_name: 'مؤسسة النقل السريع', supplier_vat: '310987654300003', doc_number: 'INV-90', category_id: 'c-4', net_amount: 8200, requested_percent: 100, due_date: day(3), review_status: 'approved', reviewed_by: fin.id, reviewed_at: at(3), created_at: at(4), doc_date: day(4) }),
    doc({ id: 'd-5', project_id: 'p-2', doc_type: 'tax_invoice', supplier_name: 'مؤسسة البناء المتقدم للمقاولات', supplier_vat: '302468013500003', doc_number: 'INV-1207', category_id: 'c-5', description: 'مستخلص رقم 1 — أعمال خرسانة', net_amount: 60000, requested_percent: 100, retention_percent: 10, review_status: 'approved', reviewed_by: fin.id, reviewed_at: at(15), created_at: at(16), doc_date: day(16) }),
  ];
  const pays = [
    { id: 'pay-1', document_id: 'd-1', project_id: 'p-1', amount: 109250, pay_date: day(8), method: 'تحويل بنكي', reference: 'TRX-88120', notes: '', created_by: fin.id, created_at: at(8) },
    { id: 'pay-2', document_id: 'd-2', project_id: 'p-1', amount: 21850, pay_date: day(4), method: 'تحويل بنكي', reference: 'TRX-88341', notes: 'دفعة مقدمة 50%', created_by: fin.id, created_at: at(4) },
    { id: 'pay-3', document_id: 'd-5', project_id: 'p-2', amount: 62100, pay_date: day(12), method: 'تحويل بنكي', reference: 'TRX-87011', notes: 'بعد خصم محتجز 10%', created_by: fin.id, created_at: at(12) },
  ];
  const att = (o) => ({ id: U.uuid(), size: 0, mime: 'image/svg+xml', document_id: null, payment_id: null, created_at: at(5), ...o });
  const attachments = [
    att({ project_id: 'p-1', document_id: 'd-1', kind: 'document', path: 'demo/invoice.svg', file_name: 'فاتورة INV-5521.svg', uploaded_by: pro.id }),
    att({ project_id: 'p-1', document_id: 'd-1', payment_id: 'pay-1', kind: 'receipt', path: 'demo/receipt.svg', file_name: 'إيصال TRX-88120.svg', uploaded_by: fin.id }),
    att({ project_id: 'p-1', document_id: 'd-2', kind: 'document', path: 'demo/quote.svg', file_name: 'عرض سعر Q-221.svg', uploaded_by: pro.id }),
    att({ project_id: 'p-1', document_id: 'd-2', payment_id: 'pay-2', kind: 'receipt', path: 'demo/receipt.svg', file_name: 'إيصال TRX-88341.svg', uploaded_by: fin.id }),
    att({ project_id: 'p-1', document_id: 'd-3', kind: 'document', path: 'demo/quote.svg', file_name: 'عرض سعر Q-87.svg', uploaded_by: pro.id }),
    att({ project_id: 'p-2', document_id: 'd-4', kind: 'document', path: 'demo/invoice.svg', file_name: 'فاتورة INV-90.svg', uploaded_by: pro.id }),
  ];
  const notifications = [
    { id: U.uuid(), recipient_id: fin.id, title: 'طلب سداد جديد', body: 'عرض سعر Q-87 — مصنع الخرسانة الجاهزة — مشروع النخيل (30%)', link: '#/project/p-1?doc=d-3', project_id: 'p-1', document_id: 'd-3', is_read: false, created_by: pro.id, created_at: at(1) },
    { id: U.uuid(), recipient_id: pro.id, title: 'تم السداد — مطلوب الفاتورة الضريبية', body: 'تم سداد 21,850.00 ر.س لشركة المعدات الثقيلة. برجاء رفع الفاتورة الضريبية.', link: '#/project/p-1?doc=d-2', project_id: 'p-1', document_id: 'd-2', is_read: false, created_by: fin.id, created_at: at(4) },
    { id: U.uuid(), recipient_id: pro.id, title: 'تم اعتماد طلب السداد', body: 'فاتورة INV-90 — مؤسسة النقل السريع', link: '#/project/p-2?doc=d-4', project_id: 'p-2', document_id: 'd-4', is_read: true, created_by: fin.id, created_at: at(3) },
  ];
  return {
    profiles: [fin, pro, mgt],
    cost_categories: cats,
    app_settings: [{ key: 'vat_rate', value: '15' }],
    projects: [p1, p2],
    budget_items: budget,
    budget_revisions: [{ id: 'r-1', project_id: 'p-1', category_id: 'c-3', amount: 5000, reason: 'إضافة رافعة شوكية لمدة شهر — أمر تغيير 2', created_by: fin.id, created_at: at(6) }],
    tax_invoices: [],
    documents: docs,
    payments: pays,
    attachments,
    notifications,
    activity_log: [],
  };
}
