'use strict';

// صفحات إضافية: الموردين وكشف الحساب، البحث الشامل، سجل النشاط، وسجل التدقيق التفصيلي
(() => {
  const { esc, num, round2, money, sar, pct } = U;

  // ---------------------------------------------------------------- سجل التدقيق (قبل / بعد)
  const TABLE_LABELS = {
    projects: 'المشروع', budget_items: 'بند الميزانية', budget_revisions: 'تعديل الميزانية', documents: 'المستند',
    tax_invoices: 'الفاتورة الضريبية', payments: 'الدفعة', attachments: 'المرفق', profiles: 'المستخدم',
  };
  const ACTION_LABELS = { INSERT: 'إنشاء', UPDATE: 'تعديل', DELETE: 'حذف' };
  const FIELD_LABELS = {
    review_status: 'حالة المراجعة', review_note: 'ملاحظة المراجعة', supplier_name: 'المورد', supplier_vat: 'الرقم الضريبي', supplier_iban: 'الآيبان',
    doc_number: 'رقم المستند', doc_date: 'تاريخ المستند', net_amount: 'قبل الضريبة', vat_amount: 'الضريبة', total_amount: 'الإجمالي',
    requested_percent: 'نسبة السداد المطلوبة', retention_percent: 'نسبة المحتجز', retention_released_at: 'الإفراج عن المحتجز', due_date: 'تاريخ الاستحقاق',
    category_id: 'البند', description: 'الوصف', notes: 'ملاحظات', amount: 'المبلغ', pay_date: 'تاريخ السداد', method: 'طريقة السداد', reference: 'المرجع',
    ti_number: 'رقم الفاتورة', ti_date: 'تاريخ الفاتورة', is_final: 'نهائية', name: 'الاسم', status: 'الحالة', role: 'الدور', full_name: 'الاسم', email: 'البريد',
    doc_type: 'نوع المستند', project_id: 'المشروع', reason: 'السبب',
  };
  const SKIP = new Set(['id', 'created_at', 'created_by', 'reviewed_by', 'reviewed_at', 'uploaded_by', 'path', 'mime', 'size']);
  const fmt = (k, v) => {
    if (v == null || v === '') return '—';
    if (k === 'review_status') return (Logic.STATUS[v] || {}).label || v;
    if (k === 'category_id') return App.category(v);
    if (k === 'project_id') return (App.project(v) || {}).name || '—';
    if (k === 'role') return Logic.ROLES[v] || v;
    if (k === 'doc_type') return Logic.TYPES[v] || v;
    if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
    if (/amount$/.test(k)) return money(v);
    return String(v).length > 60 ? `${String(v).slice(0, 60)}…` : String(v);
  };

  function auditList(rows) {
    if (!rows.length) return '<p class="muted">لا توجد تغييرات مسجلة</p>';
    return `<h4 class="sec-title">🛡 سجل التغييرات (غير قابل للتعديل)</h4><ul class="audit">${rows.map((r) => {
      let changes = '';
      if (r.action === 'UPDATE' && r.old_data && r.new_data) {
        const keys = Object.keys(r.new_data).filter((k) => !SKIP.has(k) && JSON.stringify(r.old_data[k]) !== JSON.stringify(r.new_data[k]));
        changes = keys.map((k) => `<div class="chg"><span>${esc(FIELD_LABELS[k] || k)}:</span> <s>${esc(fmt(k, r.old_data[k]))}</s> ← <b>${esc(fmt(k, r.new_data[k]))}</b></div>`).join('');
        if (!changes) return '';
      } else {
        const data = r.new_data || r.old_data || {};
        const main = ['ti_number', 'amount', 'total_amount', 'file_name', 'reason'].filter((k) => data[k] != null).map((k) => `${FIELD_LABELS[k] || 'الملف'}: ${fmt(k, data[k])}`).join(' · ');
        changes = main ? `<div class="chg">${esc(main)}</div>` : '';
      }
      return `<li class="${r.action.toLowerCase()}"><div><b>${ACTION_LABELS[r.action] || r.action} ${TABLE_LABELS[r.table_name] || r.table_name}</b>
        <span class="muted small">— ${esc(App.userName(r.user_id))} · ${U.dt(r.created_at)}</span></div>${changes}</li>`;
    }).join('')}</ul>`;
  }

  // ---------------------------------------------------------------- الموردين
  function supplierIndex() {
    const map = new Map();
    App.db.documents.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).forEach((d) => {
      const key = U.normName(d.supplier_name);
      const r = map.get(key) || { key, name: d.supplier_name, vat: '', iban: '', projects: new Set(), docs: [], approved: 0, paid: 0, pending: 0, retention: 0, uninvoiced: 0, overdue: 0, last: '' };
      r.name = d.supplier_name;
      if (d.supplier_vat) r.vat = d.supplier_vat;
      if (d.supplier_iban) r.iban = d.supplier_iban;
      r.projects.add(d.project_id);
      r.docs.push(d);
      const i = App.info(d);
      if (d.review_status === 'approved') { r.approved += i.total; r.paid += i.paid; r.retention += i.retentionHeld; r.uninvoiced += i.uninvoiced; if (i.overdueDays) r.overdue += i.dueNow; }
      if (d.review_status === 'new' || d.review_status === 'clarification') r.pending += i.total;
      if (String(d.doc_date || d.created_at) > r.last) r.last = String(d.doc_date || d.created_at).slice(0, 10);
      map.set(key, r);
    });
    return [...map.values()].map((r) => ({ ...r, approved: round2(r.approved), paid: round2(r.paid), balance: round2(r.approved - r.paid) })).sort((a, b) => b.approved - a.approved);
  }

  function suppliers(rt) {
    const q = (rt.q.get('q') || '').toLowerCase();
    const list = supplierIndex().filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.vat).includes(q));
    const html = `
      <div class="toolbar">
        ${Pages.searchBox('q', rt.q, 'بحث باسم المورد أو الرقم الضريبي…')}
        <span class="spacer"></span>
        <button class="btn ghost" data-action="exportSuppliers">⬇ Excel</button>
      </div>
      ${list.length ? `<div class="table-wrap"><table class="tbl hover">
        <thead><tr><th>المورد</th><th>الرقم الضريبي</th><th class="num">مشاريع</th><th class="num">مستندات</th><th class="num">المعتمد</th><th class="num">المسدد</th><th class="num">الرصيد المستحق</th><th class="num">محتجز</th><th>تنبيهات</th></tr></thead>
        <tbody>${list.map((r) => `<tr onclick="location.hash='#/supplier/${encodeURIComponent(r.name)}'">
          <td><b>${esc(r.name)}</b><div class="muted small">آخر تعامل ${U.date(r.last)}</div></td>
          <td dir="ltr" class="start">${r.vat ? `${esc(r.vat)} ${U.isVatNo(r.vat) ? '<span class="good-text">✓</span>' : '<span class="bad-text">⚠</span>'}` : '<span class="muted">—</span>'}</td>
          <td class="num">${r.projects.size}</td><td class="num">${r.docs.length}</td>
          <td class="num">${sar(r.approved)}</td><td class="num">${sar(r.paid)}</td><td class="num"><b>${sar(r.balance)}</b></td><td class="num">${r.retention ? sar(r.retention) : '—'}</td>
          <td>${[r.overdue > 0.005 ? `<span class="pill bad">⏰ متأخر ${money(r.overdue)}</span>` : '', r.uninvoiced > 0.005 ? `<span class="pill warn">⧗ بدون فاتورة ${money(r.uninvoiced)}</span>` : '', r.pending > 0.005 ? '<span class="pill info">● تحت المراجعة</span>' : ''].join(' ') || '<span class="muted">—</span>'}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="4">الإجمالي (${list.length} مورد)</th><th class="num">${sar(U.sum(list, (r) => r.approved))}</th><th class="num">${sar(U.sum(list, (r) => r.paid))}</th><th class="num">${sar(U.sum(list, (r) => r.balance))}</th><th class="num">${sar(U.sum(list, (r) => r.retention))}</th><th></th></tr></tfoot>
      </table></div>` : Pages.empty('لا يوجد موردين بعد — بيظهروا هنا تلقائياً مع أول مستند')}`;
    Pages._suppliers = list;
    return { title: 'الموردين', html };
  }

  function supplier(rt) {
    const key = U.normName(rt.id || '');
    const r = supplierIndex().find((x) => x.key === key);
    if (!r) return { title: 'المورد', html: Pages.empty('المورد غير موجود', '<a class="btn" href="#/suppliers">رجوع للموردين</a>') };
    const docIds = new Set(r.docs.map((d) => d.id));
    const pays = App.db.payments.filter((p) => docIds.has(p.document_id));
    const tis = App.db.tax_invoices.filter((t) => docIds.has(t.document_id));
    const docs = r.docs.slice().sort((a, b) => String(b.doc_date || b.created_at).localeCompare(String(a.doc_date || a.created_at)));
    const html = `
      <div class="print-head">كشف حساب مورد — ${esc(r.name)} — ${U.today()}</div>
      <section class="card proj-header">
        <div class="ph-main">
          <div><a href="#/suppliers" class="muted-link">الموردين</a> <span class="muted">/</span></div>
          <h2>${esc(r.name)}</h2>
          <div class="supplier-ids">
            <span>الرقم الضريبي: <b dir="ltr">${esc(r.vat || '—')}</b> ${r.vat ? (U.isVatNo(r.vat) ? '<span class="pill good">✓ صيغة صحيحة</span>' : '<span class="pill bad">⚠ صيغة غير صحيحة</span>') : ''}
              <a class="link small" href="https://zatca.gov.sa/en/eServices/Pages/eServices-007.aspx" target="_blank" rel="noopener">تحقق من التسجيل على ZATCA ↗</a></span>
            ${r.iban ? `<span>الآيبان: <b dir="ltr" class="mono">${esc(r.iban.replace(/(.{4})/g, '$1 ').trim())}</b> ${U.isIban(r.iban) ? '<span class="pill good">✓</span>' : '<span class="pill bad">⚠</span>'}</span>` : ''}
          </div>
        </div>
        <div class="ph-actions"><button class="btn ghost sm" data-action="exportSupplier" data-key="${esc(r.name)}">⬇ كشف حساب Excel</button><button class="btn ghost sm" data-action="print">🖨 طباعة</button></div>
      </section>
      <div class="kpis five">
        ${Pages.kpi('إجمالي المعتمد', sar(r.approved), `${r.docs.length} مستند · ${r.projects.size} مشروع`)}
        ${Pages.kpi('المسدد', sar(r.paid), `${pays.length} دفعة`)}
        ${Pages.kpi('الرصيد المستحق', sar(r.balance), r.overdue ? `منه متأخر ${money(r.overdue)}` : '', r.overdue ? 'bad' : '')}
        ${Pages.kpi('مسدد بدون فاتورة ضريبية', sar(r.uninvoiced), r.uninvoiced ? 'ضريبة مدخلات معلّقة' : '✓ لا يوجد', r.uninvoiced ? 'warn' : 'good')}
        ${Pages.kpi('محتجز ضمان', sar(r.retention))}
      </div>
      <section class="card"><div class="card-head"><h2>المستندات</h2></div>${Pages.docsTable(docs)}</section>
      <section class="card"><div class="card-head"><h2>الدفعات</h2></div>${Pages.paymentsTable(pays)}</section>
      ${tis.length ? `<section class="card"><div class="card-head"><h2>الفواتير الضريبية المستلمة على عروض الأسعار</h2></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>النوع</th><th>عرض السعر</th><th class="num">الإجمالي</th><th class="num">الضريبة</th></tr></thead>
        <tbody>${tis.map((t) => { const d = App.doc(t.document_id); return `<tr data-action="openDoc" data-id="${t.document_id}"><td dir="ltr" class="start">${esc(t.ti_number)}</td><td>${U.date(t.ti_date)}</td><td>${t.is_final ? 'نهائية' : 'عن دفعة'}</td><td>${esc(d.doc_number || '—')}</td><td class="num">${sar(t.total_amount)}</td><td class="num">${sar(t.vat_amount)}</td></tr>`; }).join('')}</tbody></table></div></section>` : ''}`;
    return { title: r.name, html };
  }

  // ---------------------------------------------------------------- البحث الشامل
  function search(rt) {
    const raw = (rt.q.get('q') || '').trim();
    const q = raw.toLowerCase();
    const qn = U.normName(raw);
    const amt = num(raw);
    const hit = (...vals) => vals.some((v) => v != null && (String(v).toLowerCase().includes(q) || U.normName(v).includes(qn)));
    const projects = q ? App.db.projects.filter((p) => hit(p.name, p.code, p.client, p.location)) : [];
    const docs = q ? App.db.documents.filter((d) => hit(d.supplier_name, d.doc_number, d.description, d.supplier_vat, ...Logic.tisOf(d).map((t) => t.ti_number))
      || (amt > 0 && Math.abs(Logic.effTotal(d) - amt) < 0.01)) : [];
    const pays = q ? App.db.payments.filter((p) => hit(p.reference, p.notes) || (amt > 0 && Math.abs(num(p.amount) - amt) < 0.01)) : [];
    const sups = q ? supplierIndex().filter((s) => hit(s.name, s.vat)) : [];
    const total = projects.length + docs.length + pays.length + sups.length;
    const html = `
      <div class="toolbar"><input class="search big" type="search" placeholder="ابحث في كل حاجة: مورد، رقم فاتورة، رقم حوالة، مبلغ، مشروع…" value="${esc(raw)}" data-input="search" data-key="q" autofocus></div>
      ${!q ? Pages.empty('اكتب كلمة أو رقم للبحث') : !total ? Pages.empty(`مفيش نتائج لـ "${esc(raw)}"`) : `
        <p class="muted">${total} نتيجة</p>
        ${sups.length ? `<section class="card"><div class="card-head"><h2>الموردين (${sups.length})</h2></div><div class="chip-list">${sups.map((s) => `<a class="result-chip" href="#/supplier/${encodeURIComponent(s.name)}"><b>${esc(s.name)}</b><span>${sar(s.balance)} مستحق</span></a>`).join('')}</div></section>` : ''}
        ${projects.length ? `<section class="card"><div class="card-head"><h2>المشاريع (${projects.length})</h2></div><div class="chip-list">${projects.map((p) => `<a class="result-chip" href="#/project/${p.id}"><b>${esc(p.name)}</b><span>${esc(p.code || '')} ${esc(p.client || '')}</span></a>`).join('')}</div></section>` : ''}
        ${docs.length ? `<section class="card"><div class="card-head"><h2>المستندات (${docs.length})</h2></div>${Pages.docsTable(docs)}</section>` : ''}
        ${pays.length ? `<section class="card"><div class="card-head"><h2>الدفعات (${pays.length})</h2></div>${Pages.paymentsTable(pays)}</section>` : ''}`}`;
    return { title: 'البحث', html };
  }

  // ---------------------------------------------------------------- سجل النشاط
  function activity(rt) {
    if (App.isProc()) return { title: 'سجل النشاط', html: Pages.empty('متاح للمالية والإدارة') };
    const q = rt.q;
    const s = (q.get('q') || '').toLowerCase();
    const list = App.db.activity_log
      .filter((l) => (!q.get('project') || l.project_id === q.get('project')) && (!q.get('user') || l.user_id === q.get('user'))
        && (!s || [l.action, l.details].some((x) => String(x || '').toLowerCase().includes(s))))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 500);
    const html = `
      <div class="toolbar">
        ${Pages.searchBox('q', q, 'بحث في السجل…')}
        ${Pages.filterSelect('project', 'المشروع', App.db.projects.map((p) => [p.id, p.name]), q)}
        ${Pages.filterSelect('user', 'المستخدم', App.db.profiles.map((p) => [p.id, p.full_name || p.email]), q)}
      </div>
      <p class="muted small">كل إجراء في النظام بيتسجل هنا. التغييرات التفصيلية (قبل / بعد) محفوظة في سجل تدقيق مايتعدلش ولا يتمسح — تقدر تشوفها من داخل أي مستند.</p>
      ${list.length ? `<div class="table-wrap"><table class="tbl hover">
        <thead><tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>التفاصيل</th><th>المشروع</th></tr></thead>
        <tbody>${list.map((l) => `<tr ${l.document_id && App.doc(l.document_id) ? `data-action="openDoc" data-id="${l.document_id}"` : ''}>
          <td class="nowrap">${U.dt(l.created_at)}</td><td>${esc(App.userName(l.user_id))}</td><td><b>${esc(l.action)}</b></td>
          <td>${esc(l.details || '')}</td><td>${esc((App.project(l.project_id) || {}).name || '—')}</td></tr>`).join('')}</tbody>
      </table></div>` : Pages.empty('لا يوجد نشاط')}`;
    return { title: 'سجل النشاط', html };
  }

  // ---------------------------------------------------------------- تصدير
  async function exportSuppliers() {
    const list = Pages._suppliers || supplierIndex();
    await Pages.writeXlsx(`الموردين - ${U.today()}.xlsx`, [{ name: 'الموردين', rows: [
      ['المورد', 'الرقم الضريبي', 'صيغة الرقم الضريبي', 'الآيبان', 'عدد المشاريع', 'عدد المستندات', 'المعتمد', 'المسدد', 'الرصيد المستحق', 'منه متأخر', 'مسدد بدون فاتورة ضريبية', 'محتجز'],
      ...list.map((r) => [r.name, r.vat || '', r.vat ? (U.isVatNo(r.vat) ? 'صحيحة' : 'غير صحيحة') : '', r.iban || '', r.projects.size, r.docs.length, r.approved, r.paid, r.balance, round2(r.overdue), round2(r.uninvoiced), round2(r.retention)]),
    ] }]);
  }
  async function exportSupplier(name) {
    const r = supplierIndex().find((x) => x.key === U.normName(name));
    if (!r) return;
    const docIds = new Set(r.docs.map((d) => d.id));
    await Pages.writeXlsx(`كشف حساب - ${name.replace(/[\\/:*?"<>|]/g, '-')} - ${U.today()}.xlsx`, [
      { name: 'المستندات', rows: Pages.docRows(r.docs) },
      { name: 'الدفعات', rows: Pages.payRows(App.db.payments.filter((p) => docIds.has(p.document_id))) },
    ]);
  }

  Object.assign(Pages.routes, { suppliers, supplier, search, activity });
  Object.assign(Pages, { auditList, supplierIndex, exportSuppliers, exportSupplier });
  Object.assign(Actions, {
    exportSuppliers: () => exportSuppliers(),
    exportSupplier: (d) => exportSupplier(d.key),
  });
})();
