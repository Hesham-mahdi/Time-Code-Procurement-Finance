'use strict';

// قلب التطبيق: الحالة، تحميل البيانات، التوجيه، والهيكل العام
const App = {
  cfg: window.APP_CONFIG,
  api: null,
  user: null,
  me: null,
  db: {},
  unsub: null,
  starting: false,

  async init() {
    const params = new URLSearchParams(location.search);
    const demo = !this.cfg.SUPABASE_ANON_KEY || params.has('demo') || !window.supabase;
    this.api = demo ? LocalBackend() : SupabaseBackend(this.cfg);
    TABLES.forEach((t) => { this.db[t] = []; });
    U.initTooltip();
    this.bindEvents();

    this.api.onAuth(async (event, user) => {
      if (event === 'PASSWORD_RECOVERY') { Forms.newPassword(); return; }
      if (event === 'SIGNED_OUT') { this.stop(); Pages.login(); return; }
      if (user && (!this.user || this.user.id !== user.id)) await this.start(user);
    });
    window.addEventListener('hashchange', () => { if (this.me) this.render(); });

    const user = await this.api.getUser();
    if (user) await this.start(user);
    else if (!this.user) Pages.login();
  },

  async start(user) {
    if (this.starting) return;
    this.starting = true;
    try {
      this.user = user;
      await this.loadAll();
      this.me = this.db.profiles.find((p) => p.id === user.id) || null;
      if (!this.me || ['pending', 'disabled'].includes(this.me.role)) { Pages.pending(); return; }
      if (this.unsub) this.unsub();
      this.unsub = this.api.subscribe(user.id, (n) => this.onNotification(n));
      this.render();
    } catch (e) {
      console.error(e);
      document.getElementById('app').innerHTML = `<div class="boot err">تعذر تحميل البيانات: ${U.esc(U.errMsg(e))}
        <br><br><button class="btn primary" onclick="location.reload()">إعادة المحاولة</button></div>`;
    } finally {
      this.starting = false;
    }
  },

  stop() {
    if (this.unsub) this.unsub();
    this.unsub = null;
    this.user = null;
    this.me = null;
    U.closeAll();
  },

  async loadAll() {
    const results = await Promise.all(TABLES.map((t) => this.api.select(t)));
    TABLES.forEach((t, i) => { this.db[t] = results[i]; });
    const uid = this.user && this.user.id;
    this.db.notifications = this.db.notifications
      .filter((n) => n.recipient_id === uid)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    this.db.cost_categories.sort((a, b) => U.num(a.sort) - U.num(b.sort));
    this.db.projects.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    this.db.documents.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    this.db.payments.sort((a, b) => String(b.pay_date).localeCompare(String(a.pay_date)));
    if (this.me) this.me = this.db.profiles.find((p) => p.id === this.me.id) || this.me;
  },

  async refresh() {
    await this.loadAll();
    if (this.me && ['pending', 'disabled'].includes(this.me.role)) { Pages.pending(); return; }
    this.render();
  },

  async onNotification(n) {
    U.toast(`${n.title}: ${n.body || ''}`, 'info', 6000);
    try { await this.refresh(); } catch (e) { console.error(e); }
  },

  // ---- صلاحيات ----
  get role() { return this.me ? this.me.role : null; },
  isFin() { return this.role === 'finance'; },
  isProc() { return this.role === 'procurement'; },
  canCreate() { return this.role === 'finance' || this.role === 'procurement'; },

  vatRate() {
    const s = this.db.app_settings.find((x) => x.key === 'vat_rate');
    return s ? U.num(s.value) : 15;
  },
  project(id) { return this.db.projects.find((p) => p.id === id); },
  doc(id) { return this.db.documents.find((d) => d.id === id); },
  category(id) { const c = this.db.cost_categories.find((x) => x.id === id); return c ? c.name : 'غير مصنف'; },
  userName(id) { const p = this.db.profiles.find((x) => x.id === id); return p ? (p.full_name || p.email) : '—'; },
  usersWithRole(role) { return this.db.profiles.filter((p) => p.role === role); },
  info(d) { return Logic.docInfo(d, this.db.payments); },
  docTitle(d) { return `${Logic.TYPES[d.doc_type]}${d.doc_number ? ' ' + d.doc_number : ''} — ${d.supplier_name}`; },

  // ---- إشعارات وسجل ----
  async notify(userIds, { title, body, project_id = null, document_id = null }) {
    const ids = [...new Set(userIds.filter(Boolean))].filter((id) => id !== this.me.id);
    if (!ids.length) return;
    const link = project_id ? `#/project/${project_id}${document_id ? `?doc=${document_id}` : ''}` : '';
    await this.api.insert('notifications', ids.map((recipient_id) => ({
      recipient_id, title, body, link, project_id, document_id, is_read: false, created_by: this.me.id,
    })));
  },
  notifyRole(role, payload) {
    return this.notify(this.usersWithRole(role).map((u) => u.id), payload);
  },
  async log(action, details, project_id = null, document_id = null) {
    try {
      await this.api.insert('activity_log', { action, details, project_id, document_id, user_id: this.me.id });
    } catch (e) { console.warn('log failed', e); }
  },

  // الملفات بتترفع الأول، وبعد حفظ السجل الأساسي بنسجلها في جدول المرفقات
  async storeFiles(files, { project_id, document_id = null, kind }) {
    const max = (this.cfg.MAX_FILE_MB || 10) * 1024 * 1024;
    const list = [...files];
    const big = list.find((f) => f.size > max);
    if (big) throw new Error(`الملف "${big.name}" أكبر من ${this.cfg.MAX_FILE_MB} ميجا`);
    const rows = [];
    for (const f of list) {
      const path = `${project_id}/${document_id || 'project'}/${U.fileSafeName(f.name)}`;
      await this.api.upload(f, path);
      rows.push({ project_id, document_id, payment_id: null, kind, path, file_name: f.name, mime: f.type || null, size: f.size, uploaded_by: this.me.id });
    }
    return rows;
  },
  async saveAttachments(rows, extra = {}) {
    if (rows.length) await this.api.insert('attachments', rows.map((r) => ({ ...r, ...extra })));
  },

  async openFile(attId) {
    const a = this.db.attachments.find((x) => x.id === attId);
    if (!a) return;
    const win = window.open('', '_blank');
    try {
      const url = await this.api.fileUrl(a.path);
      if (win) win.location = url; else location.href = url;
    } catch (e) {
      if (win) win.close();
      U.toast(U.errMsg(e), 'err');
    }
  },

  // ---- التوجيه ----
  route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    return { name: parts[0] || 'dashboard', id: parts[1] ? decodeURIComponent(parts[1]) : null, q: new URLSearchParams(qs || '') };
  },
  go(hash) {
    if (location.hash === hash) this.render(); else location.hash = hash;
  },

  nav() {
    const r = this.role;
    const items = [
      ['dashboard', 'لوحة التحكم', '◧'],
      ['projects', 'المشاريع', '▦'],
      ['requests', r === 'procurement' ? 'طلباتي' : 'طلبات السداد', '⇄'],
      ['payments', 'الدفعات والإيصالات', '◈'],
    ];
    if (r !== 'procurement') items.push(['reports', 'التقارير ومراكز التكلفة', '▤']);
    items.push(['notifications', 'الإشعارات', '🔔']);
    if (r === 'finance') items.push(['settings', 'الإعدادات', '⚙']);
    return items;
  },

  render() {
    if (!this.me) { Pages.login(); return; }
    const rt = this.route();
    const page = Pages.routes[rt.name] ? rt.name : 'dashboard';
    const unread = this.db.notifications.filter((n) => !n.is_read).length;
    const pendingUsers = this.isFin() ? this.db.profiles.filter((p) => p.role === 'pending').length : 0;
    const active = page === 'project' ? 'projects' : page;

    const out = Pages.routes[page](rt);
    document.title = `${out.title} — Time Code`;
    document.getElementById('app').innerHTML = `
      <div class="layout">
        <aside class="sidebar" id="sidebar">
          <div class="brand">
            <div class="logo">TC</div>
            <div><div class="brand-name">Time Code</div><div class="brand-sub">المشتريات والمالية</div></div>
          </div>
          <nav class="nav">
            ${this.nav().map(([k, label, ico]) => `
              <a href="#/${k}" class="${active === k ? 'active' : ''}">
                <span class="nav-ico" aria-hidden="true">${ico}</span><span>${label}</span>
                ${k === 'notifications' && unread ? `<span class="nav-count">${unread}</span>` : ''}
                ${k === 'settings' && pendingUsers ? `<span class="nav-count">${pendingUsers}</span>` : ''}
              </a>`).join('')}
          </nav>
          <div class="side-user">
            <div class="avatar">${U.esc((this.me.full_name || this.me.email || '?').trim().charAt(0))}</div>
            <div class="side-user-info">
              <div class="side-user-name">${U.esc(this.me.full_name || this.me.email)}</div>
              <div class="side-user-role">${Logic.ROLES[this.role]}</div>
            </div>
            <button class="icon-btn light" data-action="myPassword" title="تغيير كلمة المرور" aria-label="تغيير كلمة المرور">🔑</button>
            <button class="icon-btn light" data-action="logout" title="تسجيل الخروج" aria-label="تسجيل الخروج">⏻</button>
          </div>
        </aside>
        <div class="scrim" data-action="toggleMenu"></div>
        <div class="main">
          <header class="topbar">
            <button class="icon-btn menu-btn" data-action="toggleMenu" aria-label="القائمة">☰</button>
            <h1 class="page-title">${U.esc(out.title)}</h1>
            ${this.api.mode === 'demo' ? `<span class="demo-badge" data-tip="البيانات محفوظة على هذا المتصفح فقط. افتح تبويب تاني وادخل بمستخدم مختلف علشان تجرب الإشعارات.">وضع تجريبي</span>` : ''}
            <span class="spacer"></span>
            ${this.canCreate() ? '<button class="btn primary sm top-cta" data-action="newDoc">＋ <span>رفع مستند</span></button>' : ''}
            <button class="icon-btn theme-btn" data-action="toggleTheme" aria-label="تبديل الوضع الليلي" title="الوضع الليلي / النهاري">◐</button>
            <a href="#/notifications" class="bell" aria-label="الإشعارات">🔔${unread ? `<span class="bell-count">${unread}</span>` : ''}</a>
          </header>
          <main class="content">${out.html}</main>
        </div>
      </div>`;
    if (out.after) out.after();
    window.scrollTo(0, 0);
  },

  // ---- الأحداث ----
  bindEvents() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const fn = Actions[el.dataset.action];
      if (!fn) return;
      e.preventDefault();
      Promise.resolve(fn(el.dataset, el)).catch((err) => { console.error(err); U.toast(U.errMsg(err), 'err'); });
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-change]');
      if (!el) return;
      const fn = Actions[el.dataset.change];
      if (fn) Promise.resolve(fn(el.dataset, el)).catch((err) => { console.error(err); U.toast(U.errMsg(err), 'err'); });
    });
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (!el) return;
      const fn = Actions[el.dataset.input];
      if (fn) fn(el.dataset, el);
    });
  },
};

// إجراءات عامة مربوطة بـ data-action
const Actions = {
  logout: async () => { await App.api.signOut(); },
  toggleMenu: () => document.body.classList.toggle('menu-open'),
  toggleTheme: () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('tc_theme', root.dataset.theme); } catch (e) { /* */ }
  },
  openFile: (d) => App.openFile(d.id),
  print: () => window.print(),

  newProject: () => Forms.project(),
  editProject: (d) => Forms.project(App.project(d.id)),
  deleteProject: async (d) => {
    const p = App.project(d.id);
    if (!(await U.confirm(`حذف "${p.name}" نهائياً مع كل مستنداته ودفعاته؟`, { okLabel: 'حذف المشروع' }))) return;
    await App.api.remove('projects', p.id);
    U.toast('تم حذف المشروع');
    location.hash = '#/projects';
    await App.refresh();
  },

  newDoc: (d) => Forms.document({ project_id: d.project || null }),
  editDoc: (d) => Forms.document(App.doc(d.id)),
  openDoc: (d) => Forms.docDetails(d.id),
  review: (d) => Forms.review(d.id, d.decision),
  pay: (d) => Forms.payment(d.id),
  uploadTI: (d) => Forms.taxInvoice(d.id),
  requestMore: (d) => Forms.requestMore(d.id),
  deleteDoc: async (d) => {
    const doc = App.doc(d.id);
    if (!(await U.confirm(`حذف "${App.docTitle(doc)}" مع مرفقاته ودفعاته؟`, { okLabel: 'حذف' }))) return;
    const paths = App.db.attachments.filter((a) => a.document_id === doc.id).map((a) => a.path);
    await App.api.remove('documents', doc.id);
    await Promise.all(paths.map((p) => App.api.removeFile(p).catch(() => {})));
    await App.log('حذف مستند', App.docTitle(doc), doc.project_id, null);
    U.closeAll();
    U.toast('تم الحذف');
    await App.refresh();
  },
  deletePayment: async (d) => {
    const p = App.db.payments.find((x) => x.id === d.id);
    if (!(await U.confirm(`حذف دفعة بمبلغ ${U.money(p.amount)} ر.س؟`, { okLabel: 'حذف الدفعة' }))) return;
    await App.api.remove('payments', p.id);
    await App.log('حذف دفعة', `${U.money(p.amount)} ر.س`, p.project_id, p.document_id);
    U.closeAll();
    U.toast('تم حذف الدفعة');
    await App.refresh();
  },

  editBudget: (d) => Forms.budget(d.project),
  uploadBudgetFile: (d) => Forms.budgetFile(d.project),
  deleteAttachment: async (d) => {
    const a = App.db.attachments.find((x) => x.id === d.id);
    if (!(await U.confirm(`حذف الملف "${a.file_name}"؟`, { okLabel: 'حذف' }))) return;
    await App.api.remove('attachments', a.id);
    await App.api.removeFile(a.path).catch(() => {});
    U.toast('تم حذف الملف');
    await App.refresh();
  },

  openNotif: async (d) => {
    const n = App.db.notifications.find((x) => x.id === d.id);
    if (n && !n.is_read) await App.api.update('notifications', n.id, { is_read: true }).catch(() => {});
    if (n && n.link) location.hash = n.link; else await App.refresh();
    if (n && n.link) await App.refresh();
  },
  markAllRead: async () => {
    await App.api.updateWhere('notifications', { recipient_id: App.me.id, is_read: false }, { is_read: true });
    await App.refresh();
  },

  filter: (d, el) => {
    const rt = App.route();
    const q = rt.q;
    if (el.value) q.set(d.key, el.value); else q.delete(d.key);
    const base = `#/${rt.name}${rt.id ? '/' + rt.id : ''}`;
    const s = q.toString();
    history.replaceState(null, '', base + (s ? '?' + s : ''));
    App.render();
  },
  search: (d, el) => {
    clearTimeout(Actions._t);
    Actions._t = setTimeout(() => {
      Actions.filter(d, el);
      const again = document.querySelector(`[data-input="search"][data-key="${d.key}"]`);
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 300);
  },

  exportProject: (d) => Pages.exportProject(d.id),
  exportReport: () => Pages.exportReport(),
  exportRequests: () => Pages.exportRequests(),

  addUser: () => Forms.user(),
  editUser: (d) => Forms.user(App.db.profiles.find((u) => u.id === d.id)),
  userPassword: (d) => Forms.userPassword(App.db.profiles.find((u) => u.id === d.id)),
  myPassword: () => Forms.userPassword(App.me),
  activateUser: (d) => {
    const u = App.db.profiles.find((x) => x.id === d.id);
    Forms.user({ ...u, role: 'procurement' });
  },
  suspendUser: async (d) => {
    const u = App.db.profiles.find((x) => x.id === d.id);
    if (!(await U.confirm(`إيقاف حساب "${u.full_name || u.email}"؟ مش هيقدر يسجل دخول لحد ما تفعّله تاني.`, { okLabel: 'إيقاف الحساب' }))) return;
    await App.api.rpc('admin_update_user', { p_user_id: u.id, p_full_name: u.full_name || '', p_email: u.email, p_role: 'disabled' });
    await App.log('إيقاف مستخدم', u.full_name || u.email);
    U.toast('تم إيقاف الحساب');
    await App.refresh();
  },
  deleteUser: async (d) => {
    const u = App.db.profiles.find((x) => x.id === d.id);
    if (!(await U.confirm(`حذف حساب "${u.full_name || u.email}" نهائياً؟ المستندات اللي رفعها هتفضل موجودة. (الأفضل "إيقاف" بدل الحذف)`, { okLabel: 'حذف نهائي' }))) return;
    await App.api.rpc('admin_delete_user', { p_user_id: u.id });
    await App.log('حذف مستخدم', u.full_name || u.email);
    U.toast('تم حذف المستخدم');
    await App.refresh();
  },
  addCategory: () => Forms.category(),
  editCategory: (d) => Forms.category(App.db.cost_categories.find((c) => c.id === d.id)),
  deleteCategory: async (d) => {
    const c = App.db.cost_categories.find((x) => x.id === d.id);
    const used = App.db.documents.some((x) => x.category_id === c.id) || App.db.budget_items.some((x) => x.category_id === c.id);
    if (used) { U.toast('البند مستخدم في مستندات أو ميزانيات ولا يمكن حذفه — يمكنك تعديل اسمه', 'err'); return; }
    if (!(await U.confirm(`حذف بند "${c.name}"؟`, { okLabel: 'حذف' }))) return;
    await App.api.remove('cost_categories', c.id);
    await App.refresh();
  },
  editVat: () => Forms.vat(),
  resetDemo: async () => {
    if (!(await U.confirm('مسح كل البيانات التجريبية والرجوع للبيانات الأصلية؟', { okLabel: 'مسح' }))) return;
    App.api.resetDemo();
    location.hash = '';
    location.reload();
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
