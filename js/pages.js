'use strict';

// الصفحات ومكوناتها
const Pages = (() => {
  const { esc, num, round2, money, sar, pct } = U;

  // ================================================================ مكونات
  const pill = (st) => `<span class="pill ${st.cls}"><span aria-hidden="true">${st.icon || ''}</span> ${esc(st.label)}</span>`;
  const typeBadge = (d) => `<span class="type-badge ${d.doc_type}">${Logic.TYPES[d.doc_type]}</span>`;
  const statePill = (s) => (s ? pill(s) : '<span class="muted">—</span>');

  const progress = (paidPct, reqPct) => `
    <div class="progress" role="img" aria-label="مسدد ${pct(paidPct)} من ${pct(reqPct, 0)} مطلوب">
      <div class="progress-req" style="width:${Math.min(100, reqPct)}%"></div>
      <div class="progress-fill" style="width:${Math.min(100, paidPct)}%"></div>
    </div>
    <div class="progress-legend"><span><i class="sw fill"></i> مسدد ${pct(paidPct)}</span><span><i class="sw req"></i> مطلوب ${pct(reqPct, 0)}</span></div>`;

  const usageBar = (t) => {
    if (!t.budget && !t.committed) return '<div class="usage empty">لا توجد ميزانية أو مستندات بعد</div>';
    const u = t.usage == null ? 100 : t.usage;
    return `<div class="usage">
      <div class="usage-track"><div class="usage-fill ${t.state ? t.state.cls : ''}" style="width:${Math.min(100, u)}%"></div></div>
      <div class="usage-meta">${statePill(t.state)}<span class="muted">${t.usage == null ? 'بدون ميزانية' : `مستهلك ${pct(t.usage)}`}</span></div>
    </div>`;
  };

  const kpi = (label, value, sub = '', tone = '') => `
    <div class="kpi ${tone}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

  const empty = (msg, action = '') => `<div class="empty-state"><div class="empty-ico" aria-hidden="true">◌</div><p>${msg}</p>${action}</div>`;

  function docsTable(docs, { showProject = true } = {}) {
    if (!docs.length) return empty('لا توجد مستندات');
    return `<div class="table-wrap"><table class="tbl hover">
      <thead><tr><th>النوع</th><th>المورد / الرقم</th>${showProject ? '<th>المشروع</th>' : ''}<th>البند</th><th>التاريخ</th>
        <th class="num">الإجمالي</th><th class="num">المطلوب</th><th>السداد</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${docs.map((d) => {
        const i = App.info(d);
        const p = App.project(d.project_id);
        return `<tr data-action="openDoc" data-id="${d.id}">
          <td>${typeBadge(d)}</td>
          <td><b>${esc(d.supplier_name)}</b><div class="muted small">${esc(d.doc_number || '—')}</div></td>
          ${showProject ? `<td>${esc(p ? p.name : '—')}</td>` : ''}
          <td>${esc(App.category(d.category_id))}</td>
          <td class="nowrap">${U.date(d.doc_date)}</td>
          <td class="num">${sar(i.total)}</td>
          <td class="num">${pct(num(d.requested_percent), 0)}</td>
          <td class="pay-cell"><div class="mini-bar"><div style="width:${Math.min(100, i.paidPct)}%"></div></div><span class="small muted">${pct(i.paidPct)}</span></td>
          <td>${pill(i.st)}${i.needsTI ? '<div class="small warn-text">⧗ مطلوب الفاتورة الضريبية</div>' : ''}</td>
          <td><button class="btn sm ghost" data-action="openDoc" data-id="${d.id}">عرض</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function paymentsTable(pays, { showProject = true } = {}) {
    if (!pays.length) return empty('لا توجد دفعات');
    return `<div class="table-wrap"><table class="tbl hover">
      <thead><tr><th>تاريخ السداد</th><th>المستند</th>${showProject ? '<th>المشروع</th>' : ''}<th class="num">المبلغ</th><th>الطريقة</th><th>المرجع</th><th>الإيصال</th></tr></thead>
      <tbody>${pays.map((x) => {
        const d = App.doc(x.document_id);
        const p = App.project(x.project_id);
        const r = App.db.attachments.filter((a) => a.payment_id === x.id);
        return `<tr data-action="openDoc" data-id="${x.document_id}">
          <td class="nowrap">${U.date(x.pay_date)}</td>
          <td>${d ? `${typeBadge(d)} <b>${esc(d.supplier_name)}</b> <span class="muted small">${esc(d.doc_number || '')}</span>` : '—'}</td>
          ${showProject ? `<td>${esc(p ? p.name : '—')}</td>` : ''}
          <td class="num">${sar(x.amount)}</td>
          <td>${esc(x.method || '—')}</td>
          <td>${esc(x.reference || '—')}</td>
          <td>${r.map((a) => `<button class="link" data-action="openFile" data-id="${a.id}">📎 الإيصال</button>`).join(' ') || '<span class="pill bad">بدون إيصال</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr><th colspan="${showProject ? 3 : 2}">الإجمالي (${pays.length} دفعة)</th><th class="num">${sar(U.sum(pays, (x) => x.amount))}</th><th colspan="3"></th></tr></tfoot>
    </table></div>`;
  }

  const attTile = (a) => `
    <button type="button" class="att" data-action="openFile" data-id="${a.id}" title="${esc(a.file_name)}">
      ${U.isImage(a.mime, a.file_name) ? `<img data-thumb="${a.id}" alt="${esc(a.file_name)}">` : `<span class="att-ico">${esc(((a.file_name || '').split('.').pop() || 'ملف').toUpperCase().slice(0, 4))}</span>`}
      <span class="att-name">${esc(a.file_name)}</span>
    </button>`;

  async function loadThumbs(root) {
    const imgs = [...root.querySelectorAll('img[data-thumb]')];
    await Promise.all(imgs.map(async (img) => {
      const a = App.db.attachments.find((x) => x.id === img.dataset.thumb);
      try { img.src = await App.api.fileUrl(a.path); } catch (e) { img.replaceWith(Object.assign(document.createElement('span'), { className: 'att-ico', textContent: '؟' })); }
    }));
  }

  // مخطط "تقديري مقابل فعلي" لكل بند: المسار = التقديري، الشريط = الملتزم، الخط الداخلي = المسدد
  function costChart(rows) {
    const data = rows.filter((r) => r.budget > 0 || r.committed > 0);
    if (!data.length) return empty('أدخل العرض المالي التقديري أو اعتمد مستندات علشان يظهر المخطط');
    const max = Math.max(1, ...data.map((r) => Math.max(r.budget, r.committed)));
    const w = (v) => `${((v / max) * 100).toFixed(2)}%`;
    return `
      <div class="legend" aria-hidden="true">
        <span><i class="lg budget"></i> التقديري</span>
        <span><i class="lg committed"></i> الملتزم به</span>
        <span><i class="lg paid"></i> المسدد فعلاً</span>
      </div>
      <div class="bullets">${data.map((r) => {
        const tip = `<b>${esc(r.name)}</b><br>التقديري: ${money(r.budget)}<br>الملتزم به: ${money(r.committed)}<br>المسدد: ${money(r.paid)}<br>الانحراف: ${money(r.variance)}${r.usage != null ? `<br>الاستهلاك: ${pct(r.usage)}` : ''}`;
        return `<div class="bullet" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(`${r.name}: تقديري ${money(r.budget)}، ملتزم ${money(r.committed)}، مسدد ${money(r.paid)}`)}">
          <div class="b-label">${esc(r.name)}</div>
          <div class="b-track">
            ${r.budget > 0 ? `<div class="b-budget" style="width:${w(r.budget)}"></div>` : ''}
            ${r.committed > 0 ? `<div class="b-committed" style="width:${w(r.committed)}"></div>` : ''}
            ${r.paid > 0 ? `<div class="b-paid" style="width:${w(r.paid)}"></div>` : ''}
            ${r.budget > 0 ? `<div class="b-mark" style="inset-inline-start:${w(r.budget)}"></div>` : ''}
          </div>
          <div class="b-val">${r.usage != null ? `<b>${pct(r.usage, 0)}</b>` : ''} ${statePill(r.state)}</div>
        </div>`;
      }).join('')}</div>`;
  }

  function costTable(c) {
    const t = c.totals;
    const varCell = (v) => `<td class="num ${v < 0 ? 'bad-text' : ''}">${sar(v)}</td>`;
    return `<div class="table-wrap"><table class="tbl cost-tbl">
      <thead><tr><th>البند</th><th class="num">التكلفة التقديرية</th><th class="num">الملتزم به</th><th class="num">المسدد فعلاً</th>
        <th class="num">تحت المراجعة</th><th class="num">الانحراف (تقديري − ملتزم)</th><th class="num">الاستهلاك</th><th>الحالة</th></tr></thead>
      <tbody>${c.rows.map((r) => `<tr>
        <td><b>${esc(r.name)}</b></td><td class="num">${sar(r.budget)}</td><td class="num">${sar(r.committed)}</td><td class="num">${sar(r.paid)}</td>
        <td class="num muted">${sar(r.pending)}</td>${varCell(r.variance)}<td class="num">${pct(r.usage)}</td><td>${statePill(r.state)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>الإجمالي</th><th class="num">${sar(t.budget)}</th><th class="num">${sar(t.committed)}</th><th class="num">${sar(t.paid)}</th>
        <th class="num">${sar(t.pending)}</th><th class="num ${t.variance < 0 ? 'bad-text' : ''}">${sar(t.variance)}</th><th class="num">${pct(t.usage)}</th><th>${statePill(t.state)}</th></tr></tfoot>
    </table></div>
    <p class="note">كل المبالغ قبل ضريبة القيمة المضافة. الضريبة على المستندات المعتمدة: ${sar(t.vat)} · الإجمالي شامل الضريبة: ${sar(t.committedGross)} · المتبقي للسداد للموردين: ${sar(t.remainingGross)}</p>`;
  }

  const filterSelect = (key, label, options, q) => `
    <label class="filter"><span class="sr-only">${label}</span>
      <select data-change="filter" data-key="${key}" aria-label="${label}">
        <option value="">${label}: الكل</option>
        ${options.map(([v, l]) => `<option value="${esc(v)}" ${q.get(key) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select></label>`;
  const searchBox = (key, q, ph) => `<input class="search" type="search" placeholder="${ph}" value="${esc(q.get(key) || '')}" data-input="search" data-key="${key}" aria-label="${ph}">`;

  const thisMonth = () => U.today().slice(0, 7);

  // ================================================================ الصفحات
  function dashboard() {
    const docs = App.db.documents;
    const infos = docs.map((d) => ({ d, i: App.info(d) }));
    const monthPaid = U.sum(App.db.payments.filter((p) => String(p.pay_date).startsWith(thisMonth())), (p) => p.amount);
    const costs = App.db.projects.map((p) => ({ p, c: Logic.projectCost(p.id, App.db) }));
    const over = costs.filter((x) => x.c.totals.state && x.c.totals.state.cls === 'bad');
    const role = App.role;
    let html = '';

    if (role === 'procurement') {
      const mine = infos.filter((x) => x.i.needsTI || x.i.needsFix);
      html = `
        <div class="hero-actions">
          <button class="btn primary lg" data-action="newDoc">＋ رفع فاتورة / عرض سعر</button>
          <button class="btn lg" data-action="newProject">＋ مشروع جديد</button>
        </div>
        <div class="kpis">
          ${kpi('بانتظار مراجعة المالية', infos.filter((x) => x.d.review_status === 'new').length)}
          ${kpi('معتمد بانتظار السداد', infos.filter((x) => x.i.needsPayment).length, sar(U.sum(infos.filter((x) => x.i.needsPayment), (x) => x.i.dueNow)))}
          ${kpi('مطلوب منك إجراء', mine.length, 'فواتير ضريبية / استيضاحات', mine.length ? 'attn' : '')}
          ${kpi('مسدد هذا الشهر', sar(monthPaid))}
        </div>
        <section class="card"><div class="card-head"><h2>مطلوب منك</h2></div>
          ${mine.length ? docsTable(mine.map((x) => x.d)) : empty('مفيش حاجة مطلوبة منك حالياً ✓')}</section>
        <section class="card"><div class="card-head"><h2>آخر الطلبات</h2><a href="#/requests" class="link">عرض الكل</a></div>
          ${docsTable(docs.slice(0, 8))}</section>`;
    } else {
      const action = infos.filter((x) => x.i.needsReview || x.i.needsPayment);
      const dueTotal = U.sum(infos.filter((x) => x.i.needsPayment), (x) => x.i.dueNow);
      const pendingUsers = App.db.profiles.filter((p) => p.role === 'pending');
      html = `
        ${role === 'finance' && pendingUsers.length ? `<div class="callout info">فيه ${pendingUsers.length} مستخدم جديد بانتظار التفعيل — <a href="#/settings" class="link">حدد صلاحياتهم من الإعدادات</a></div>` : ''}
        <div class="kpis">
          ${kpi('طلبات بانتظار المراجعة', infos.filter((x) => x.i.needsReview).length, '', infos.some((x) => x.i.needsReview) ? 'attn' : '')}
          ${kpi('مستحق السداد', sar(dueTotal), `${infos.filter((x) => x.i.needsPayment).length} طلب معتمد`)}
          ${kpi('مسدد هذا الشهر', sar(monthPaid))}
          ${kpi('مشاريع تجاوزت الميزانية', over.length, over.map((x) => esc(x.p.name)).join('، ') || 'لا يوجد', over.length ? 'bad' : '')}
        </div>
        <section class="card"><div class="card-head"><h2>${role === 'finance' ? 'يحتاج إجراء منك' : 'بانتظار إجراء المالية'}</h2><a href="#/requests" class="link">كل الطلبات</a></div>
          ${action.length ? docsTable(action.map((x) => x.d)) : empty('كل الطلبات متعامل معاها ✓')}</section>
        <section class="card"><div class="card-head"><h2>مراكز التكلفة — المشاريع الجارية</h2><a href="#/reports" class="link">التقرير الكامل</a></div>
          ${costs.filter((x) => x.p.status === 'active').length ? `<div class="proj-mini">${costs.filter((x) => x.p.status === 'active').map(({ p, c }) => `
            <a class="proj-mini-row" href="#/project/${p.id}?tab=cost">
              <div class="pm-name"><b>${esc(p.name)}</b><span class="muted small">${esc(p.code || '')}</span></div>
              <div class="pm-nums"><span>تقديري ${sar(c.totals.budget)}</span><span>ملتزم ${sar(c.totals.committed)}</span></div>
              ${usageBar(c.totals)}
            </a>`).join('')}</div>` : empty('لا توجد مشاريع جارية')}
        </section>`;
    }
    return { title: 'لوحة التحكم', html };
  }

  function projects(rt) {
    const q = rt.q;
    const s = (q.get('q') || '').toLowerCase();
    const list = App.db.projects.filter((p) => (!q.get('status') || p.status === q.get('status'))
      && (!s || [p.name, p.code, p.client, p.location].some((x) => String(x || '').toLowerCase().includes(s))));
    const html = `
      <div class="toolbar">
        ${searchBox('q', q, 'بحث باسم المشروع أو الكود أو العميل…')}
        ${filterSelect('status', 'الحالة', Object.entries(Logic.PROJECT_STATUS), q)}
        <span class="spacer"></span>
        ${App.canCreate() ? '<button class="btn primary" data-action="newProject">＋ مشروع جديد</button>' : ''}
      </div>
      ${list.length ? `<div class="proj-grid">${list.map((p) => {
        const c = Logic.projectCost(p.id, App.db);
        const docs = App.db.documents.filter((d) => d.project_id === p.id);
        const waiting = docs.filter((d) => { const i = App.info(d); return i.needsReview || i.needsPayment; }).length;
        return `<a class="proj-card" href="#/project/${p.id}">
          <div class="pc-head"><div><h3>${esc(p.name)}</h3><div class="muted small">${esc([p.code, p.client, p.location].filter(Boolean).join(' · ') || '—')}</div></div>
            <span class="pill ${p.status === 'active' ? 'good' : p.status === 'on_hold' ? 'warn' : 'neutral'}">${Logic.PROJECT_STATUS[p.status]}</span></div>
          <div class="pc-nums">
            <div><span>التقديري</span><b>${sar(c.totals.budget)}</b></div>
            <div><span>الملتزم به</span><b>${sar(c.totals.committed)}</b></div>
            <div><span>المسدد</span><b>${sar(c.totals.paid)}</b></div>
          </div>
          ${usageBar(c.totals)}
          <div class="pc-foot muted small"><span>${docs.length} مستند</span>${waiting ? `<span class="warn-text">● ${waiting} بانتظار المالية</span>` : ''}</div>
        </a>`;
      }).join('')}</div>` : empty(App.db.projects.length ? 'لا توجد نتائج' : 'لا توجد مشاريع بعد', App.canCreate() ? '<button class="btn primary" data-action="newProject">＋ إنشاء أول مشروع</button>' : '')}`;
    return { title: 'المشاريع', html };
  }

  function project(rt) {
    const p = App.project(rt.id);
    if (!p) return { title: 'المشروع غير موجود', html: empty('المشروع غير موجود أو تم حذفه', '<a class="btn" href="#/projects">رجوع للمشاريع</a>') };
    const tab = rt.q.get('tab') || 'docs';
    const c = Logic.projectCost(p.id, App.db);
    const t = c.totals;
    const docs = App.db.documents.filter((d) => d.project_id === p.id);
    const pays = App.db.payments.filter((x) => x.project_id === p.id);
    const tabs = [['docs', `المستندات (${docs.length})`], ['payments', `الدفعات (${pays.length})`], ['budget', 'العرض المالي التقديري'], ['cost', 'مركز التكلفة والمقارنة']];
    let body = '';

    if (tab === 'docs') {
      const tq = rt.q.get('type');
      const list = docs.filter((d) => !tq || d.doc_type === tq);
      body = `<div class="toolbar">
          ${filterSelect('type', 'النوع', Object.entries(Logic.TYPES), rt.q)}
          <span class="spacer"></span>
          ${App.canCreate() ? `<button class="btn primary" data-action="newDoc" data-project="${p.id}">＋ رفع فاتورة / عرض سعر</button>` : ''}
        </div>${docsTable(list, { showProject: false })}`;
    } else if (tab === 'payments') {
      body = paymentsTable(pays, { showProject: false });
    } else if (tab === 'budget') {
      const items = App.db.budget_items.filter((b) => b.project_id === p.id);
      const files = App.db.attachments.filter((a) => a.project_id === p.id && a.kind === 'budget');
      body = `<div class="toolbar"><p class="muted">التكلفة التقديرية لكل بند قبل الضريبة — من العرض المالي.</p><span class="spacer"></span>
          ${App.isFin() ? `<button class="btn primary" data-action="editBudget" data-project="${p.id}">✎ ${items.length ? 'تعديل' : 'إدخال'} العرض المالي</button>` : ''}</div>
        ${items.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>البند</th><th class="num">التكلفة التقديرية</th><th class="num">النسبة</th><th>ملاحظات</th></tr></thead>
          <tbody>${items.slice().sort((a, b) => num((App.db.cost_categories.find((x) => x.id === a.category_id) || {}).sort) - num((App.db.cost_categories.find((x) => x.id === b.category_id) || {}).sort)).map((b) => `<tr><td><b>${esc(App.category(b.category_id))}</b></td><td class="num">${sar(b.amount)}</td>
            <td class="num">${pct(t.budget ? (num(b.amount) / t.budget) * 100 : 0)}</td><td>${esc(b.description || '')}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th>الإجمالي</th><th class="num">${sar(t.budget)}</th><th class="num">100%</th><th></th></tr></tfoot></table></div>`
          : empty(App.isFin() ? 'لم يتم إدخال العرض المالي التقديري بعد' : 'المالية لم تُدخل العرض المالي التقديري بعد')}
        <h4 class="sec-title">ملفات العرض المالي</h4>
        ${files.length ? `<div class="att-grid">${files.map((a) => `<div class="att-wrap">${attTile(a)}${App.isFin() ? `<button class="icon-btn att-del" data-action="deleteAttachment" data-id="${a.id}" aria-label="حذف الملف">✕</button>` : ''}</div>`).join('')}</div>` : '<p class="muted">لا توجد ملفات</p>'}
        ${App.isFin() ? `<button class="btn ghost" data-action="uploadBudgetFile" data-project="${p.id}">📎 إرفاق ملف</button>` : ''}`;
    } else {
      body = `<div class="toolbar"><p class="muted">مقارنة التكلفة التقديرية بالفعلية لكل بند (قبل الضريبة).</p><span class="spacer"></span>
          <button class="btn ghost" data-action="exportProject" data-id="${p.id}">⬇ تصدير Excel</button>
          <button class="btn ghost" data-action="print">🖨 طباعة</button></div>
        <section class="card flat">${costChart(c.rows)}</section>
        ${costTable(c)}`;
    }

    const html = `
      <div class="print-head">تقرير مركز التكلفة — ${esc(p.name)} — ${U.today()}</div>
      <section class="proj-header card">
        <div class="ph-main">
          <div><a href="#/projects" class="muted-link">المشاريع</a> <span class="muted">/</span></div>
          <h2>${esc(p.name)} <span class="pill ${p.status === 'active' ? 'good' : p.status === 'on_hold' ? 'warn' : 'neutral'}">${Logic.PROJECT_STATUS[p.status]}</span></h2>
          <div class="muted">${esc([p.code, p.client, p.location, p.start_date ? 'البدء ' + p.start_date : ''].filter(Boolean).join(' · ') || '—')}</div>
          ${p.notes ? `<p class="small">${esc(p.notes)}</p>` : ''}
        </div>
        <div class="ph-actions">
          ${App.canCreate() ? `<button class="btn ghost sm" data-action="editProject" data-id="${p.id}">✎ تعديل</button>` : ''}
          ${App.isFin() ? `<button class="btn danger-ghost sm" data-action="deleteProject" data-id="${p.id}">حذف</button>` : ''}
        </div>
      </section>
      <div class="kpis five">
        ${kpi('التكلفة التقديرية', sar(t.budget))}
        ${kpi('الملتزم به', sar(t.committed), t.pending ? `+ ${money(t.pending)} تحت المراجعة` : '')}
        ${kpi('المسدد فعلاً', sar(t.paid), 'قبل الضريبة')}
        ${kpi('المتبقي للسداد', sar(t.remainingGross), 'شامل الضريبة')}
        ${kpi('الانحراف', sar(t.variance), t.state ? `${t.state.icon} ${t.state.label}` : '', t.state ? t.state.cls : '')}
      </div>
      <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" aria-selected="${tab === k}" class="${tab === k ? 'active' : ''}" href="#/project/${p.id}?tab=${k}">${l}</a>`).join('')}</nav>
      <section class="tab-body">${body}</section>`;

    const openDoc = rt.q.get('doc');
    return {
      title: p.name,
      html,
      after: () => {
        if (openDoc) {
          rt.q.delete('doc');
          const s = rt.q.toString();
          history.replaceState(null, '', `#/project/${p.id}${s ? '?' + s : ''}`);
          Forms.docDetails(openDoc);
        }
      },
    };
  }

  function requests(rt) {
    const q = rt.q;
    const s = (q.get('q') || '').toLowerCase();
    const st = q.get('status');
    let list = App.db.documents.filter((d) => {
      const i = App.info(d);
      if (q.get('project') && d.project_id !== q.get('project')) return false;
      if (q.get('type') && d.doc_type !== q.get('type')) return false;
      if (st === 'action_fin' && !(i.needsReview || i.needsPayment)) return false;
      if (st === 'action_proc' && !(i.needsTI || i.needsFix)) return false;
      if (st && !st.startsWith('action_') && i.status !== st) return false;
      if (s && ![d.supplier_name, d.doc_number, d.description, d.ti_number].some((x) => String(x || '').toLowerCase().includes(s))) return false;
      return true;
    });
    if (App.isProc() && q.get('mine') === '1') list = list.filter((d) => d.created_by === App.me.id);
    const totals = list.map((d) => App.info(d));
    const statusOpts = [['action_fin', '● بانتظار إجراء المالية'], ['action_proc', '● بانتظار إجراء المشتريات'], ...Object.entries(Logic.STATUS).map(([k, v]) => [k, v.label])];
    const html = `
      <div class="toolbar">
        ${searchBox('q', q, 'بحث بالمورد أو رقم المستند…')}
        ${filterSelect('project', 'المشروع', App.db.projects.map((p) => [p.id, p.name]), q)}
        ${filterSelect('status', 'الحالة', statusOpts, q)}
        ${filterSelect('type', 'النوع', Object.entries(Logic.TYPES), q)}
        <span class="spacer"></span>
        <button class="btn ghost" data-action="exportRequests">⬇ Excel</button>
        ${App.canCreate() ? '<button class="btn primary" data-action="newDoc">＋ رفع مستند</button>' : ''}
      </div>
      <div class="summary-line">
        <span>${list.length} مستند</span>
        <span>الإجمالي ${sar(U.sum(totals, (i) => i.total))}</span>
        <span>المسدد ${sar(U.sum(totals, (i) => i.paid))}</span>
        <span>المستحق حالياً ${sar(U.sum(totals, (i) => i.dueNow))}</span>
      </div>
      ${docsTable(list)}`;
    Pages._requestsList = list;
    return { title: App.isProc() ? 'طلباتي' : 'طلبات السداد', html };
  }

  function payments(rt) {
    const q = rt.q;
    const s = (q.get('q') || '').toLowerCase();
    const list = App.db.payments.filter((x) => {
      if (q.get('project') && x.project_id !== q.get('project')) return false;
      if (q.get('month') && !String(x.pay_date).startsWith(q.get('month'))) return false;
      const d = App.doc(x.document_id);
      if (s && ![x.reference, d && d.supplier_name, d && d.doc_number].some((v) => String(v || '').toLowerCase().includes(s))) return false;
      return true;
    });
    const months = [...new Set(App.db.payments.map((x) => String(x.pay_date).slice(0, 7)))].sort().reverse();
    const html = `
      <div class="toolbar">
        ${searchBox('q', q, 'بحث بالمورد أو رقم الحوالة…')}
        ${filterSelect('project', 'المشروع', App.db.projects.map((p) => [p.id, p.name]), q)}
        ${filterSelect('month', 'الشهر', months.map((m) => [m, m]), q)}
      </div>
      ${paymentsTable(list)}`;
    return { title: 'الدفعات والإيصالات', html };
  }

  function supplierSummary() {
    const map = new Map();
    App.db.documents.filter((d) => d.review_status === 'approved').forEach((d) => {
      const i = App.info(d);
      const r = map.get(d.supplier_name) || { name: d.supplier_name, vat: d.supplier_vat, count: 0, total: 0, paid: 0 };
      r.count += 1; r.total += i.total; r.paid += i.paid;
      map.set(d.supplier_name, r);
    });
    return [...map.values()].map((r) => ({ ...r, total: round2(r.total), paid: round2(r.paid), remaining: round2(r.total - r.paid) })).sort((a, b) => b.total - a.total);
  }

  function reports() {
    const rows = App.db.projects.map((p) => ({ p, t: Logic.projectCost(p.id, App.db).totals }));
    const T = {};
    ['budget', 'committed', 'paid', 'pending', 'variance', 'remainingGross'].forEach((k) => { T[k] = round2(U.sum(rows, (r) => r.t[k])); });
    const tState = Logic.usageState(T.budget, T.committed);
    const sup = supplierSummary();
    const html = `
      <div class="print-head">تقرير مراكز التكلفة — كل المشاريع — ${U.today()}</div>
      <div class="toolbar"><p class="muted">مقارنة التكلفة التقديرية بالفعلية لكل المشاريع — المبالغ قبل الضريبة.</p><span class="spacer"></span>
        <button class="btn ghost" data-action="exportReport">⬇ تصدير Excel</button>
        <button class="btn ghost" data-action="print">🖨 طباعة</button></div>
      <div class="kpis">
        ${kpi('إجمالي التقديري', sar(T.budget))}
        ${kpi('إجمالي الملتزم به', sar(T.committed))}
        ${kpi('إجمالي المسدد', sar(T.paid))}
        ${kpi('الانحراف الكلي', sar(T.variance), tState ? `${tState.icon} ${tState.label}` : '', tState ? tState.cls : '')}
      </div>
      <section class="card"><div class="card-head"><h2>المشاريع</h2></div>
      ${rows.length ? `<div class="table-wrap"><table class="tbl hover">
        <thead><tr><th>المشروع</th><th>الحالة</th><th class="num">التقديري</th><th class="num">الملتزم به</th><th class="num">المسدد</th><th class="num">تحت المراجعة</th><th class="num">الانحراف</th><th class="num">الاستهلاك</th><th>التقييم</th><th class="num">المتبقي للموردين (شامل)</th></tr></thead>
        <tbody>${rows.map(({ p, t }) => `<tr onclick="location.hash='#/project/${p.id}?tab=cost'">
          <td><b>${esc(p.name)}</b><div class="muted small">${esc(p.code || '')}</div></td><td>${Logic.PROJECT_STATUS[p.status]}</td>
          <td class="num">${sar(t.budget)}</td><td class="num">${sar(t.committed)}</td><td class="num">${sar(t.paid)}</td><td class="num muted">${sar(t.pending)}</td>
          <td class="num ${t.variance < 0 ? 'bad-text' : ''}">${sar(t.variance)}</td><td class="num">${pct(t.usage)}</td><td>${statePill(t.state)}</td><td class="num">${sar(t.remainingGross)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="2">الإجمالي</th><th class="num">${sar(T.budget)}</th><th class="num">${sar(T.committed)}</th><th class="num">${sar(T.paid)}</th><th class="num">${sar(T.pending)}</th>
          <th class="num ${T.variance < 0 ? 'bad-text' : ''}">${sar(T.variance)}</th><th class="num">${pct(T.budget ? (T.committed / T.budget) * 100 : null)}</th><th>${statePill(tState)}</th><th class="num">${sar(T.remainingGross)}</th></tr></tfoot>
      </table></div>` : empty('لا توجد مشاريع')}</section>
      <section class="card"><div class="card-head"><h2>حسب المورد</h2><span class="muted small">المستندات المعتمدة — شامل الضريبة</span></div>
      ${sup.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>المورد</th><th>الرقم الضريبي</th><th class="num">عدد المستندات</th><th class="num">الإجمالي</th><th class="num">المسدد</th><th class="num">المتبقي</th></tr></thead>
        <tbody>${sup.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.vat || '—')}</td><td class="num">${r.count}</td><td class="num">${sar(r.total)}</td><td class="num">${sar(r.paid)}</td><td class="num">${sar(r.remaining)}</td></tr>`).join('')}</tbody>
      </table></div>` : empty('لا توجد مستندات معتمدة')}</section>`;
    return { title: 'التقارير ومراكز التكلفة', html };
  }

  function notifications() {
    const list = App.db.notifications;
    const html = `
      <div class="toolbar"><span class="muted">${list.filter((n) => !n.is_read).length} غير مقروء</span><span class="spacer"></span>
        ${list.some((n) => !n.is_read) ? '<button class="btn ghost" data-action="markAllRead">✓ تعليم الكل كمقروء</button>' : ''}</div>
      ${list.length ? `<ul class="notif-list">${list.map((n) => `
        <li><button class="notif ${n.is_read ? '' : 'unread'}" data-action="openNotif" data-id="${n.id}">
          <span class="notif-dot" aria-hidden="true"></span>
          <span class="notif-body"><b>${esc(n.title)}</b><span>${esc(n.body || '')}</span></span>
          <span class="notif-time muted small">${U.ago(n.created_at)}<br>${esc(App.userName(n.created_by))}</span>
        </button></li>`).join('')}</ul>` : empty('لا توجد إشعارات')}`;
    return { title: 'الإشعارات', html };
  }

  function settings() {
    if (!App.isFin()) return { title: 'الإعدادات', html: empty('الإعدادات متاحة للمالية فقط') };
    const ROLE_CLS = { finance: 'blue', procurement: 'good', management: 'neutral', pending: 'warn', disabled: 'bad' };
    const order = { pending: 0, finance: 1, procurement: 2, management: 3, disabled: 4 };
    const users = App.db.profiles.slice().sort((a, b) => order[a.role] - order[b.role] || String(a.full_name).localeCompare(String(b.full_name), 'ar'));
    const count = (r) => users.filter((u) => u.role === r).length;
    const html = `
      <section class="card users-card"><div class="card-head"><div><h2>المستخدمين والصلاحيات</h2>
          <p class="muted small">أنت مدير النظام — أضف الحسابات بكلمات مرورها، وحدد دور كل مستخدم.</p></div>
          <button class="btn primary" data-action="addUser">＋ إضافة مستخدم</button></div>
        <div class="role-stats">
          ${['finance', 'procurement', 'management', 'disabled'].map((r) => `<div><b>${count(r)}</b><span>${Logic.ROLES[r]}</span></div>`).join('')}
        </div>
        <div class="table-wrap"><table class="tbl users-tbl">
          <thead><tr><th>المستخدم</th><th>الدور</th><th>تاريخ الإضافة</th><th class="end">الإجراءات</th></tr></thead>
          <tbody>${users.map((u) => {
            const self = u.id === App.me.id;
            return `<tr class="${u.role === 'pending' ? 'row-attn' : ''} ${u.role === 'disabled' ? 'row-off' : ''}">
              <td><div class="user-cell"><span class="avatar sm">${esc((u.full_name || u.email || '?').charAt(0))}</span>
                <div><b>${esc(u.full_name || '—')}</b>${self ? ' <span class="pill neutral">أنت</span>' : ''}<div class="muted small" dir="ltr">${esc(u.email || '')}</div></div></div></td>
              <td><span class="pill ${ROLE_CLS[u.role]}">${Logic.ROLES[u.role]}</span></td>
              <td class="nowrap">${U.date(u.created_at)}</td>
              <td class="end"><div class="row-actions">
                <button class="btn sm ghost" data-action="editUser" data-id="${u.id}">✎ تعديل</button>
                <button class="btn sm ghost" data-action="userPassword" data-id="${u.id}">🔑 كلمة المرور</button>
                ${self ? '' : u.role === 'disabled' || u.role === 'pending'
                  ? `<button class="btn sm ghost good-text" data-action="activateUser" data-id="${u.id}">▶ تفعيل</button>`
                  : `<button class="btn sm ghost warn-text" data-action="suspendUser" data-id="${u.id}">⏸ إيقاف</button>`}
                ${self ? '' : `<button class="icon-btn" data-action="deleteUser" data-id="${u.id}" title="حذف المستخدم" aria-label="حذف المستخدم">🗑</button>`}
              </div></td></tr>`;
          }).join('')}</tbody>
        </table></div></section>
      <div class="grid2 cards">
        <section class="card"><div class="card-head"><h2>بنود التكلفة</h2><button class="btn sm primary" data-action="addCategory">＋ بند</button></div>
          <ul class="simple-list">${App.db.cost_categories.map((c) => `<li><span>${esc(c.name)}</span>
            <span><button class="icon-btn" data-action="editCategory" data-id="${c.id}" aria-label="تعديل">✎</button>
            <button class="icon-btn" data-action="deleteCategory" data-id="${c.id}" aria-label="حذف">🗑</button></span></li>`).join('')}</ul></section>
        <section class="card"><div class="card-head"><h2>الضريبة</h2><button class="btn sm ghost" data-action="editVat">✎ تعديل</button></div>
          <p>نسبة ضريبة القيمة المضافة: <b>${App.vatRate()}%</b></p>
          <p class="muted small">مراكز التكلفة بتتحسب قبل الضريبة، والضريبة بتظهر في عمود منفصل.</p>
          <h4 class="sec-title">الاتصال</h4>
          <p class="small">${App.api.mode === 'supabase' ? `متصل بـ Supabase ✓<br><span class="muted">${esc(App.cfg.SUPABASE_URL)}</span>` : 'وضع تجريبي — البيانات على هذا المتصفح فقط'}</p>
          ${App.api.mode === 'demo' ? '<button class="btn danger-ghost sm" data-action="resetDemo">مسح البيانات التجريبية</button>' : ''}
        </section>
      </div>`;
    return { title: 'الإعدادات', html };
  }

  // ================================================================ الدخول
  const pwField = (name, label, auto, extra = '') => `
    <label class="field"><span class="lbl">${label}</span>
      <span class="pw-wrap">
        <input type="password" name="${name}" required minlength="6" autocomplete="${auto}" dir="ltr" ${extra}>
        <button type="button" class="pw-eye" data-eye aria-label="إظهار كلمة المرور" title="إظهار / إخفاء">👁</button>
      </span>
    </label>`;

  const pwScore = (p) => {
    let s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
    if (/\d/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return Math.min(4, s);
  };
  const PW_LABELS = ['ضعيفة جداً', 'ضعيفة', 'متوسطة', 'قوية', 'قوية جداً'];

  function bindPwUi(root) {
    root.querySelectorAll('[data-eye]').forEach((b) => b.addEventListener('click', () => {
      const i = b.previousElementSibling;
      const show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      b.classList.toggle('on', show);
      b.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    }));
    root.querySelectorAll('input[type=password], .pw-wrap input').forEach((i) => i.addEventListener('keyup', (e) => {
      const cap = root.querySelector('[data-caps]');
      if (cap && e.getModifierState) cap.hidden = !e.getModifierState('CapsLock');
    }));
    const meter = root.querySelector('[data-meter]');
    if (meter) {
      const src = root.querySelector(`[name="${meter.dataset.meter}"]`);
      src.addEventListener('input', () => {
        const s = src.value ? pwScore(src.value) : -1;
        meter.dataset.score = s;
        meter.querySelector('span').textContent = s < 0 ? '' : PW_LABELS[s];
      });
    }
  }

  async function login(mode) {
    const demo = App.api.mode === 'demo';
    let setupError = '';
    if (!mode) {
      mode = 'in';
      try { if (await App.api.rpc('app_needs_setup')) mode = 'setup'; } catch (e) {
        console.warn(e);
        if (/app_needs_setup|schema cache|does not exist|404/i.test(e.message || '')) setupError = 'قاعدة البيانات لسه ما اتجهزتش — شغّل ملف supabase/schema.sql في Supabase (SQL Editor) وبعدين حدّث الصفحة.';
      }
    }
    const titles = { in: 'تسجيل الدخول', setup: 'إعداد حساب مدير النظام', reset: 'استعادة كلمة المرور' };
    const subs = {
      in: 'أدخل بريدك الإلكتروني وكلمة المرور',
      setup: 'أول مرة تفتح النظام — أنشئ حسابك كمدير (المالية). بعدها تقدر تضيف باقي المستخدمين.',
      reset: 'هنبعتلك رابط تعيين كلمة مرور جديدة — أو اطلب من مدير النظام يغيرها لك',
    };
    document.title = `${titles[mode]} — Time Code`;
    document.getElementById('app').innerHTML = `
      <div class="auth">
        <section class="auth-visual" aria-hidden="true">
          <div class="av-grid"></div>
          <div class="av-orb o1"></div><div class="av-orb o2"></div>
          <div class="av-content">
            <div class="av-brand"><div class="logo xl">TC</div><div><b>Time Code</b><span>المشتريات × المالية</span></div></div>
            <h2>كل فاتورة، كل دفعة، كل ريال —<br><em>في مكان واحد.</em></h2>
            <ul class="av-points">
              <li><span>🧾</span><div><b>طلبات سداد بضغطة</b><small>المشتريات ترفع الفاتورة أو عرض السعر بالصورة ونسبة السداد</small></div></li>
              <li><span>🔔</span><div><b>إشعارات لحظية</b><small>السداد والإيصال يوصلوا للمشتريات فوراً، والفاتورة الضريبية ترجع للمالية</small></div></li>
              <li><span>📊</span><div><b>مركز تكلفة حي</b><small>التقديري مقابل الفعلي لكل مشروع ولكل بند</small></div></li>
            </ul>
            <div class="av-card">
              <div class="avc-row"><span>مشروع النخيل</span><b>78%</b></div>
              <div class="avc-bar"><i style="width:78%"></i></div>
              <div class="avc-row small"><span>ملتزم 253,000</span><span>تقديري 325,000</span></div>
            </div>
          </div>
        </section>
        <section class="auth-panel">
          <div class="auth-card">
            <div class="auth-brand-sm"><div class="logo">TC</div><b>Time Code</b></div>
            <h1 class="auth-title">${titles[mode]}</h1>
            <p class="auth-sub">${subs[mode]}</p>
            ${setupError ? `<div class="callout bad">${esc(setupError)}</div>` : ''}
            <form id="authForm" class="auth-form" novalidate>
              ${mode === 'setup' ? '<label class="field"><span class="lbl">الاسم الكامل</span><input name="full_name" required maxlength="80" autocomplete="name"></label>' : ''}
              <label class="field"><span class="lbl">البريد الإلكتروني</span><input type="email" name="email" required autocomplete="${mode === 'setup' ? 'email' : 'username'}" dir="ltr" placeholder="name@timecode.com.sa"></label>
              ${mode === 'in' ? pwField('password', 'كلمة المرور', 'current-password') : ''}
              ${mode === 'setup' ? `${pwField('password', 'كلمة المرور', 'new-password')}
                <div class="pw-meter" data-meter="password" data-score="-1"><i></i><i></i><i></i><i></i><span></span></div>
                ${pwField('password2', 'تأكيد كلمة المرور', 'new-password')}` : ''}
              <div class="caps" data-caps hidden>⇪ زر Caps Lock مفعّل</div>
              <div class="auth-msg" role="alert" hidden></div>
              <button class="btn primary block lg" type="submit">${mode === 'in' ? 'دخول' : mode === 'setup' ? 'إنشاء حساب المدير والدخول' : 'إرسال رابط الاستعادة'}</button>
            </form>
            <div class="auth-links">
              ${mode === 'reset' ? '<button class="link" data-mode="in">→ رجوع لتسجيل الدخول</button>' : ''}
              ${mode === 'in' && !demo ? '<button class="link" data-mode="reset">نسيت كلمة المرور؟</button>' : ''}
            </div>
            ${demo && mode === 'in' ? `<div class="demo-box">
              <div class="demo-head"><b>وضع تجريبي</b><span>ادخل بأي مستخدم بدون كلمة مرور</span></div>
              <div class="demo-users">${App.api.demoUsers().map((u) => `<button class="demo-user" data-demo="${esc(u.email)}"><span class="avatar sm">${esc(u.full_name.charAt(0))}</span><span><b>${esc(u.full_name)}</b><small>${Logic.ROLES[u.role]}</small></span></button>`).join('')}</div>
              <p class="small muted">افتح تبويب تاني بمستخدم مختلف علشان تجرب الإشعارات بين المشتريات والمالية.</p>
            </div>` : ''}
            <p class="auth-foot">الحسابات بيضيفها مدير النظام فقط · Time Code © ${new Date().getFullYear()}</p>
          </div>
        </section>
      </div>`;
    const form = document.getElementById('authForm');
    const msg = form.querySelector('.auth-msg');
    const show = (t, ok) => { msg.textContent = t; msg.hidden = false; msg.className = `auth-msg ${ok ? 'ok' : 'err'}`; };
    bindPwUi(form);
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => login(b.dataset.mode)));
    document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => App.api.signIn(b.dataset.demo).catch((e) => show(U.errMsg(e)))));
    setTimeout(() => { const f = form.querySelector('input'); if (f) f.focus(); }, 50);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const v = U.formObj(form);
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      btn.classList.add('loading');
      try {
        if (mode === 'in') await App.api.signIn(v.email, v.password);
        else if (mode === 'setup') {
          if (v.password !== v.password2) throw new Error('كلمتا المرور غير متطابقتين');
          await App.api.rpc('bootstrap_admin', { p_email: v.email, p_password: v.password, p_full_name: v.full_name });
          await App.api.signIn(v.email, v.password);
        } else {
          await App.api.resetPassword(v.email);
          show('لو البريد مسجل هتوصلك رسالة فيها رابط تعيين كلمة مرور جديدة.', true);
        }
      } catch (ex) {
        show(U.errMsg(ex));
      } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    });
  }

  function pending() {
    const me = App.me || {};
    document.getElementById('app').innerHTML = `
      <div class="auth"><div class="auth-card center">
        <div class="logo lg">TC</div>
        <h2>${me.role === 'disabled' ? 'الحساب موقوف' : 'حسابك بانتظار التفعيل'}</h2>
        <p class="muted">${me.role === 'disabled' ? 'تواصل مع المالية لإعادة تفعيل الحساب.' : 'تم تسجيلك بنجاح. المالية لازم تحدد صلاحيتك (مشتريات / مالية / إدارة) قبل ما تقدر تستخدم النظام.'}</p>
        <p class="small">${esc(me.full_name || '')} — <span dir="ltr">${esc(me.email || (App.user && App.user.email) || '')}</span></p>
        <div class="row-btns"><button class="btn primary" onclick="location.reload()">تحديث</button><button class="btn ghost" id="pendingOut">تسجيل الخروج</button></div>
      </div></div>`;
    document.getElementById('pendingOut').addEventListener('click', () => App.api.signOut());
  }

  // ================================================================ التصدير
  let xlsxLoading = null;
  const loadXLSX = () => {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxLoading) {
      xlsxLoading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
        s.onload = res;
        s.onerror = () => { xlsxLoading = null; rej(new Error('تعذر تحميل مكتبة Excel — تحقق من الإنترنت')); };
        document.head.appendChild(s);
      });
    }
    return xlsxLoading;
  };
  async function writeXlsx(filename, sheets) {
    await loadXLSX();
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    sheets.forEach((s) => {
      const ws = XLSX.utils.aoa_to_sheet(s.rows);
      ws['!cols'] = s.rows[0].map((_, c) => ({ wch: Math.min(45, Math.max(10, ...s.rows.map((r) => String(r[c] ?? '').length + 2))) }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    });
    XLSX.writeFile(wb, filename);
  }
  const fileStamp = () => U.today();
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-');

  const docRows = (docs) => [
    ['المشروع', 'النوع', 'المورد', 'الرقم الضريبي', 'رقم المستند', 'التاريخ', 'البند', 'الوصف', 'قبل الضريبة', 'الضريبة', 'الإجمالي', 'نسبة السداد المطلوبة %', 'المسدد', 'نسبة المسدد %', 'المتبقي', 'الحالة', 'رقم الفاتورة الضريبية'],
    ...docs.map((d) => {
      const i = App.info(d);
      return [(App.project(d.project_id) || {}).name, Logic.TYPES[d.doc_type], d.supplier_name, d.supplier_vat || '', d.doc_number || '', d.doc_date || '',
        App.category(d.category_id), d.description || '', i.net, i.vat, i.total, num(d.requested_percent), i.paid, round2(i.paidPct), i.remaining, i.st.label, d.ti_number || ''];
    }),
  ];
  const payRows = (pays) => [
    ['المشروع', 'المورد', 'رقم المستند', 'تاريخ السداد', 'المبلغ', 'الطريقة', 'المرجع', 'ملاحظات'],
    ...pays.map((x) => {
      const d = App.doc(x.document_id) || {};
      return [(App.project(x.project_id) || {}).name, d.supplier_name || '', d.doc_number || '', x.pay_date, num(x.amount), x.method || '', x.reference || '', x.notes || ''];
    }),
  ];

  async function exportProject(id) {
    const p = App.project(id);
    const c = Logic.projectCost(id, App.db);
    const t = c.totals;
    await writeXlsx(`مركز تكلفة - ${safe(p.name)} - ${fileStamp()}.xlsx`, [
      { name: 'مركز التكلفة', rows: [
        ['البند', 'التكلفة التقديرية', 'الملتزم به', 'المسدد فعلاً', 'تحت المراجعة', 'الانحراف', 'نسبة الاستهلاك %', 'الحالة'],
        ...c.rows.map((r) => [r.name, r.budget, r.committed, r.paid, r.pending, r.variance, r.usage == null ? '' : round2(r.usage), r.state ? r.state.label : '']),
        ['الإجمالي', t.budget, t.committed, t.paid, t.pending, t.variance, t.usage == null ? '' : round2(t.usage), t.state ? t.state.label : ''],
        [],
        ['المبالغ قبل ضريبة القيمة المضافة'],
      ] },
      { name: 'المستندات', rows: docRows(App.db.documents.filter((d) => d.project_id === id)) },
      { name: 'الدفعات', rows: payRows(App.db.payments.filter((x) => x.project_id === id)) },
    ]);
  }

  async function exportReport() {
    const rows = App.db.projects.map((p) => ({ p, t: Logic.projectCost(p.id, App.db).totals }));
    await writeXlsx(`تقرير مراكز التكلفة - ${fileStamp()}.xlsx`, [
      { name: 'المشاريع', rows: [
        ['المشروع', 'الكود', 'العميل', 'الحالة', 'التقديري', 'الملتزم به', 'المسدد', 'تحت المراجعة', 'الانحراف', 'الاستهلاك %', 'التقييم', 'المتبقي للموردين (شامل الضريبة)'],
        ...rows.map(({ p, t }) => [p.name, p.code || '', p.client || '', Logic.PROJECT_STATUS[p.status], t.budget, t.committed, t.paid, t.pending, t.variance, t.usage == null ? '' : round2(t.usage), t.state ? t.state.label : '', t.remainingGross]),
      ] },
      { name: 'حسب المورد', rows: [['المورد', 'الرقم الضريبي', 'عدد المستندات', 'الإجمالي', 'المسدد', 'المتبقي'], ...supplierSummary().map((r) => [r.name, r.vat || '', r.count, r.total, r.paid, r.remaining])] },
      { name: 'كل المستندات', rows: docRows(App.db.documents) },
      { name: 'كل الدفعات', rows: payRows(App.db.payments) },
    ]);
  }

  async function exportRequests() {
    await writeXlsx(`طلبات السداد - ${fileStamp()}.xlsx`, [{ name: 'طلبات السداد', rows: docRows(Pages._requestsList || App.db.documents) }]);
  }

  return {
    routes: { dashboard, projects, project, requests, payments, reports, notifications, settings },
    login, pending, pill, progress, bindPwUi, attTile, loadThumbs, exportProject, exportReport, exportRequests,
  };
})();