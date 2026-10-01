'use strict';

// النوافذ والنماذج
const Forms = (() => {
  const { esc, num, round2, money, sar, pct } = U;

  const field = (label, input, { hint = '', cls = '', req = false } = {}) => `
    <label class="field ${cls}">
      <span class="lbl">${label}${req ? ' <b class="req">*</b>' : ''}</span>
      ${input}
      ${hint ? `<span class="hint">${hint}</span>` : ''}
    </label>`;
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const moneyInput = (name, value, attrs = '') =>
    `<input type="number" name="${name}" step="0.01" min="0" inputmode="decimal" value="${value ?? ''}" ${attrs}>`;
  const fileInput = (name, required, accept = 'image/*,application/pdf') =>
    `<input type="file" name="${name}" multiple accept="${accept}" ${required ? 'required' : ''}>`;
  const filesOf = (form, name) => [...(form.querySelector(`[name="${name}"]`).files || [])];

  // ---------------------------------------------------------------- مشروع
  function project(p) {
    const isEdit = !!p;
    p = p || { status: 'active', start_date: U.today() };
    U.modal({
      title: isEdit ? 'تعديل بيانات المشروع' : 'مشروع جديد',
      submitLabel: isEdit ? 'حفظ التعديلات' : 'إنشاء المشروع',
      body: `
        <div class="grid2">
          ${field('اسم المشروع', `<input name="name" required maxlength="150" value="${esc(p.name)}">`, { req: true, cls: 'span2' })}
          ${field('كود المشروع', `<input name="code" maxlength="40" value="${esc(p.code)}" placeholder="PRJ-001">`)}
          ${field('العميل', `<input name="client" maxlength="150" value="${esc(p.client)}">`)}
          ${field('الموقع', `<input name="location" maxlength="150" value="${esc(p.location)}">`)}
          ${field('تاريخ البدء', `<input type="date" name="start_date" value="${esc(p.start_date || '')}">`)}
          ${field('الحالة', `<select name="status">${Object.entries(Logic.PROJECT_STATUS).map(([k, v]) => opt(k, v, p.status === k)).join('')}</select>`)}
          ${field('ملاحظات', `<textarea name="notes" rows="2">${esc(p.notes)}</textarea>`, { cls: 'span2' })}
        </div>`,
      onSubmit: async (form) => {
        const v = U.formObj(form);
        const row = { name: v.name, code: v.code || null, client: v.client || null, location: v.location || null, start_date: v.start_date || null, status: v.status, notes: v.notes || null };
        if (isEdit) {
          await App.api.update('projects', p.id, row);
          await App.log('تعديل مشروع', row.name, p.id);
          U.toast('تم حفظ المشروع');
          await App.refresh();
        } else {
          const [created] = await App.api.insert('projects', { id: U.uuid(), ...row, created_by: App.me.id });
          await App.log('إنشاء مشروع', row.name, created.id);
          if (!App.isFin()) {
            await App.notifyRole('finance', { title: 'مشروع جديد', body: `${row.name} — برجاء إدخال العرض المالي التقديري`, project_id: created.id });
          }
          U.toast('تم إنشاء المشروع');
          await App.loadAll();
          App.go(`#/project/${created.id}`);
        }
      },
    });
  }

  // ---------------------------------------------------------------- مستند (فاتورة / عرض سعر)
  function docForm(d) {
    const isEdit = !!(d && d.id);
    d = d || {};
    const rate = App.vatRate();
    const projects = App.db.projects.filter((p) => p.status !== 'completed' || p.id === d.project_id);
    if (!projects.length) { U.toast('أنشئ مشروعاً أولاً', 'err'); return; }
    const suppliers = [...new Map(App.db.documents.map((x) => [x.supplier_name, x.supplier_vat])).entries()];
    const noVat = isEdit && num(d.vat_amount) === 0 && num(d.net_amount) > 0;
    const type = d.doc_type || 'tax_invoice';

    U.closeAll();
    U.modal({
      title: isEdit ? 'تعديل المستند' : 'رفع فاتورة / عرض سعر',
      submitLabel: isEdit ? (App.isFin() ? 'حفظ' : 'حفظ وإعادة الإرسال للمالية') : 'إرسال طلب السداد',
      wide: true,
      body: `
        ${isEdit && d.review_note && !App.isFin() ? `<div class="callout warn"><b>ملاحظة المالية:</b> ${esc(d.review_note)}</div>` : ''}
        <div class="type-pick" role="radiogroup" aria-label="نوع المستند">
          <label class="type-card"><input type="radio" name="doc_type" value="tax_invoice" ${type === 'tax_invoice' ? 'checked' : ''}>
            <span class="tc-ico">🧾</span><span><b>فاتورة ضريبية</b><small>فاتورة نهائية من المورد</small></span></label>
          <label class="type-card"><input type="radio" name="doc_type" value="quotation" ${type === 'quotation' ? 'checked' : ''}>
            <span class="tc-ico">📄</span><span><b>عرض سعر</b><small>الفاتورة الضريبية تُرفع بعد السداد</small></span></label>
        </div>
        <div class="grid3">
          ${field('المشروع', `<select name="project_id" required>${d.project_id ? '' : '<option value="">اختر المشروع…</option>'}${projects.map((p) => opt(p.id, `${p.name}${p.code ? ' (' + p.code + ')' : ''}`, p.id === d.project_id)).join('')}</select>`, { req: true })}
          ${field('المورد', `<input name="supplier_name" list="supplierList" required maxlength="150" value="${esc(d.supplier_name)}">
            <datalist id="supplierList">${suppliers.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>`, { req: true })}
          ${field('الرقم الضريبي للمورد', `<input name="supplier_vat" maxlength="20" inputmode="numeric" value="${esc(d.supplier_vat)}">`)}
          ${field('رقم المستند', `<input name="doc_number" maxlength="60" value="${esc(d.doc_number)}">`)}
          ${field('تاريخ المستند', `<input type="date" name="doc_date" value="${esc(d.doc_date || U.today())}">`)}
          ${field('بند التكلفة', `<select name="category_id" required><option value="">اختر البند…</option>${App.db.cost_categories.map((c) => opt(c.id, c.name, c.id === d.category_id)).join('')}</select>`, { req: true })}
          ${field('الوصف', `<input name="description" maxlength="300" value="${esc(d.description)}" placeholder="مثال: حديد تسليح 16 مم">`, { cls: 'span3' })}
        </div>
        <div class="amount-box">
          <div class="grid3">
            ${field('المبلغ قبل الضريبة', moneyInput('net_amount', d.net_amount, 'required min="0.01" data-calc'), { req: true })}
            ${field(`ضريبة القيمة المضافة (${rate}%)`, moneyInput('vat_amount', d.vat_amount, 'data-calc-vat'), { hint: '<label class="check"><input type="checkbox" name="no_vat" ' + (noVat ? 'checked' : '') + '> المورد غير مسجل ضريبياً</label>' })}
            ${field('الإجمالي شامل الضريبة', `<output class="big-out" data-total>—</output>`)}
          </div>
          <div class="grid3">
            ${field('نسبة السداد المطلوبة %', `<div class="pct-row"><input type="number" name="requested_percent" min="1" max="100" step="0.01" required value="${d.requested_percent ?? 100}">
              <span class="chips">${[25, 30, 50, 100].map((x) => `<button type="button" class="chip" data-pct="${x}">${x}%</button>`).join('')}</span></div>`, { req: true })}
            ${field('المبلغ المطلوب سداده', `<output class="big-out accent" data-req>—</output>`)}
            ${field('تاريخ الاستحقاق', `<input type="date" name="due_date" value="${esc(d.due_date || '')}">`)}
          </div>
        </div>
        <div class="grid2">
          ${field(isEdit ? 'إضافة مرفقات أخرى' : 'صورة المستند (صورة أو PDF)', fileInput('files', !isEdit), { req: !isEdit, hint: `حتى ${App.cfg.MAX_FILE_MB} ميجا للملف — تقدر تختار أكتر من ملف أو تصور بالموبايل` })}
          ${field('ملاحظات', `<textarea name="notes" rows="3">${esc(d.notes)}</textarea>`)}
        </div>`,
      onOpen: (wrap, form) => {
        const $ = (s) => form.querySelector(s);
        let vatTouched = isEdit;
        const calc = () => {
          const net = num($('[name=net_amount]').value);
          const noV = $('[name=no_vat]').checked;
          const vatEl = $('[name=vat_amount]');
          vatEl.readOnly = noV;
          if (noV) vatEl.value = '0';
          else if (!vatTouched) vatEl.value = net ? round2(net * rate / 100).toFixed(2) : '';
          const total = round2(net + num(vatEl.value));
          const p = num($('[name=requested_percent]').value);
          $('[data-total]').innerHTML = net ? sar(total) : '—';
          $('[data-req]').innerHTML = net ? sar(round2(total * p / 100)) : '—';
        };
        form.addEventListener('input', (e) => {
          if (e.target.name === 'vat_amount') vatTouched = true;
          if (e.target.name === 'net_amount' && !isEdit) vatTouched = false;
          calc();
        });
        form.addEventListener('change', (e) => {
          if (e.target.name === 'no_vat') { vatTouched = false; calc(); }
          if (e.target.name === 'supplier_name') {
            const hit = suppliers.find(([n]) => n === e.target.value);
            if (hit && hit[1] && !$('[name=supplier_vat]').value) $('[name=supplier_vat]').value = hit[1];
          }
        });
        form.querySelectorAll('[data-pct]').forEach((b) => b.addEventListener('click', () => {
          $('[name=requested_percent]').value = b.dataset.pct;
          calc();
        }));
        calc();
      },
      onSubmit: async (form) => {
        const v = U.formObj(form);
        const net = round2(v.net_amount);
        const vat = v.no_vat ? 0 : round2(v.vat_amount);
        const reqPct = round2(v.requested_percent);
        if (net <= 0) throw new Error('أدخل المبلغ قبل الضريبة');
        if (reqPct <= 0 || reqPct > 100) throw new Error('نسبة السداد يجب أن تكون بين 1 و 100');
        const files = filesOf(form, 'files');
        if (!isEdit && !files.length) throw new Error('أرفق صورة المستند');
        const row = {
          project_id: v.project_id, doc_type: v.doc_type, supplier_name: v.supplier_name, supplier_vat: v.supplier_vat || null,
          doc_number: v.doc_number || null, doc_date: v.doc_date || null, category_id: v.category_id, description: v.description || null,
          net_amount: net, vat_amount: vat, total_amount: round2(net + vat), requested_percent: reqPct,
          due_date: v.due_date || null, notes: v.notes || null,
        };
        const id = isEdit ? d.id : U.uuid();
        const pending = await App.storeFiles(files, { project_id: row.project_id, document_id: id, kind: 'document' });
        const pname = App.project(row.project_id).name;
        const label = `${Logic.TYPES[row.doc_type]}${row.doc_number ? ' ' + row.doc_number : ''} — ${row.supplier_name} — ${pname} (${reqPct}%)`;

        if (isEdit) {
          const resubmit = !App.isFin() && d.review_status !== 'approved';
          if (resubmit) Object.assign(row, { review_status: 'new' });
          await App.api.update('documents', id, row);
          await App.saveAttachments(pending);
          await App.log(resubmit ? 'تعديل وإعادة إرسال' : 'تعديل مستند', label, row.project_id, id);
          if (resubmit) await App.notifyRole('finance', { title: 'تم تعديل طلب سداد وإعادة إرساله', body: label, project_id: row.project_id, document_id: id });
          U.toast(resubmit ? 'تم الحفظ وإعادة الإرسال للمالية' : 'تم حفظ التعديلات');
        } else {
          await App.api.insert('documents', { id, ...row, review_status: 'new', created_by: App.me.id });
          await App.saveAttachments(pending);
          await App.log('رفع مستند', label, row.project_id, id);
          await App.notifyRole('finance', { title: 'طلب سداد جديد', body: label, project_id: row.project_id, document_id: id });
          U.toast('تم إرسال طلب السداد للمالية');
        }
        await App.refresh();
      },
    });
  }

  // ---------------------------------------------------------------- تفاصيل المستند
  function docDetails(id) {
    const d = App.doc(id);
    if (!d) { U.toast('المستند غير موجود', 'err'); return; }
    const i = App.info(d);
    const p = App.project(d.project_id);
    const atts = App.db.attachments.filter((a) => a.document_id === d.id);
    const pays = App.db.payments.filter((x) => x.document_id === d.id).sort((a, b) => String(a.pay_date).localeCompare(String(b.pay_date)));
    const logs = App.db.activity_log.filter((l) => l.document_id === d.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const fin = App.isFin();
    const proc = App.isProc();
    const mine = App.canCreate();
    const overpaid = round2(i.paid - i.total);

    const group = (kind, title) => {
      const list = atts.filter((a) => a.kind === kind);
      if (!list.length) return '';
      return `<div class="att-group"><h5>${title}</h5><div class="att-grid">${list.map(Pages.attTile).join('')}</div></div>`;
    };

    const btns = [];
    if (fin && (d.review_status === 'new' || d.review_status === 'clarification')) {
      btns.push(`<button class="btn primary" data-action="review" data-id="${d.id}" data-decision="approved">✓ اعتماد</button>`);
      btns.push(`<button class="btn warn" data-action="review" data-id="${d.id}" data-decision="clarification">? طلب استيضاح</button>`);
      btns.push(`<button class="btn danger-ghost" data-action="review" data-id="${d.id}" data-decision="rejected">✕ رفض</button>`);
    }
    if (fin && d.review_status === 'approved' && i.remaining > 0) btns.push(`<button class="btn primary" data-action="pay" data-id="${d.id}">＋ تسجيل دفعة وإرفاق الإيصال</button>`);
    if (mine && i.needsTI) btns.push(`<button class="btn primary" data-action="uploadTI" data-id="${d.id}">⬆ رفع الفاتورة الضريبية</button>`);
    if (proc && i.canRequestMore) btns.push(`<button class="btn" data-action="requestMore" data-id="${d.id}">طلب سداد دفعة إضافية</button>`);
    if ((proc && d.review_status !== 'approved') || fin) btns.push(`<button class="btn ghost" data-action="editDoc" data-id="${d.id}">✎ تعديل</button>`);
    if (fin || (proc && d.review_status === 'new' && d.created_by === App.me.id)) btns.push(`<button class="btn danger-ghost" data-action="deleteDoc" data-id="${d.id}">حذف</button>`);

    U.closeAll();
    U.modal({
      title: App.docTitle(d),
      wide: true,
      body: `
        <div class="doc-head">
          <span class="type-badge ${d.doc_type}">${Logic.TYPES[d.doc_type]}</span>
          ${Pages.pill(i.st)}
          ${i.needsTI ? '<span class="pill warn">⧗ مطلوب رفع الفاتورة الضريبية</span>' : ''}
          <a class="muted-link" href="#/project/${p.id}" data-close>${esc(p.name)}</a>
        </div>
        ${d.review_note && d.review_status !== 'approved' ? `<div class="callout ${d.review_status === 'rejected' ? 'bad' : 'warn'}"><b>${d.review_status === 'rejected' ? 'سبب الرفض' : 'ملاحظة المالية'}:</b> ${esc(d.review_note)}</div>` : ''}
        ${d.review_note && d.review_status === 'approved' ? `<div class="callout info"><b>ملاحظة الاعتماد:</b> ${esc(d.review_note)}</div>` : ''}
        ${overpaid > 0.005 ? `<div class="callout bad"><b>تنبيه:</b> المسدد أكبر من قيمة المستند بمقدار ${sar(overpaid)} — يلزم استرداد أو تسوية مع المورد.</div>` : ''}
        ${d.ti_total != null && Math.abs(i.tiDiff) > 0.005 ? `<div class="callout warn">قيمة الفاتورة الضريبية تختلف عن عرض السعر بمقدار <b>${sar(i.tiDiff)}</b> (العرض ${sar(d.total_amount)} ← الفاتورة ${sar(d.ti_total)}). الحسابات معتمدة على قيمة الفاتورة.</div>` : ''}

        <div class="pay-progress">
          <div class="pp-row">
            <div><span class="muted">الإجمالي</span><b>${sar(i.total)}</b></div>
            <div><span class="muted">المسدد</span><b>${sar(i.paid)}</b></div>
            <div><span class="muted">المتبقي</span><b>${sar(i.remaining)}</b></div>
            <div><span class="muted">المطلوب حالياً (${pct(num(d.requested_percent), 0)})</span><b class="accent">${sar(i.dueNow)}</b></div>
          </div>
          ${Pages.progress(i.paidPct, num(d.requested_percent))}
        </div>

        <dl class="facts">
          <div><dt>المورد</dt><dd>${esc(d.supplier_name)}${d.supplier_vat ? `<small> · ض.ب ${esc(d.supplier_vat)}</small>` : ''}</dd></div>
          <div><dt>رقم وتاريخ المستند</dt><dd>${esc(d.doc_number || '—')} · ${U.date(d.doc_date)}</dd></div>
          <div><dt>بند التكلفة</dt><dd>${esc(App.category(d.category_id))}</dd></div>
          <div><dt>قبل الضريبة / الضريبة</dt><dd>${sar(i.net)} / ${sar(i.vat)}</dd></div>
          ${d.ti_total != null ? `<div><dt>الفاتورة الضريبية</dt><dd>${esc(d.ti_number || '—')} · ${U.date(d.ti_date)}</dd></div>` : ''}
          <div><dt>تاريخ الاستحقاق</dt><dd>${U.date(d.due_date)}</dd></div>
          <div><dt>رفعه</dt><dd>${esc(App.userName(d.created_by))} · ${U.dt(d.created_at)}</dd></div>
          ${d.reviewed_at ? `<div><dt>راجعه</dt><dd>${esc(App.userName(d.reviewed_by))} · ${U.dt(d.reviewed_at)}</dd></div>` : ''}
          ${d.description ? `<div class="wide"><dt>الوصف</dt><dd>${esc(d.description)}</dd></div>` : ''}
          ${d.notes ? `<div class="wide"><dt>ملاحظات</dt><dd>${esc(d.notes)}</dd></div>` : ''}
        </dl>

        <h4 class="sec-title">المرفقات</h4>
        ${group('document', d.doc_type === 'quotation' ? 'عرض السعر' : 'الفاتورة')}
        ${group('tax_invoice', 'الفاتورة الضريبية')}
        ${group('receipt', 'إيصالات السداد')}
        ${atts.length ? '' : '<p class="muted">لا توجد مرفقات</p>'}

        <h4 class="sec-title">الدفعات</h4>
        ${pays.length ? `<div class="table-wrap"><table class="tbl">
          <thead><tr><th>التاريخ</th><th>المبلغ</th><th>النسبة</th><th>الطريقة</th><th>المرجع</th><th>الإيصال</th>${fin ? '<th></th>' : ''}</tr></thead>
          <tbody>${pays.map((x) => {
            const r = atts.filter((a) => a.payment_id === x.id);
            return `<tr><td>${U.date(x.pay_date)}</td><td class="num">${sar(x.amount)}</td><td class="num">${pct(i.total ? (x.amount / i.total) * 100 : 0)}</td>
              <td>${esc(x.method || '—')}</td><td>${esc(x.reference || '—')}</td>
              <td>${r.map((a) => `<button class="link" data-action="openFile" data-id="${a.id}">📎 عرض</button>`).join(' ') || '<span class="pill bad">بدون إيصال</span>'}</td>
              ${fin ? `<td><button class="icon-btn" data-action="deletePayment" data-id="${x.id}" title="حذف الدفعة" aria-label="حذف الدفعة">🗑</button></td>` : ''}</tr>`;
          }).join('')}</tbody></table></div>` : '<p class="muted">لم يتم تسجيل دفعات بعد</p>'}

        ${logs.length ? `<h4 class="sec-title">السجل</h4><ul class="timeline">${logs.map((l) => `<li><b>${esc(l.action)}</b> — ${esc(App.userName(l.user_id))} <span class="muted">· ${U.dt(l.created_at)}</span>${l.details ? `<div class="muted small">${esc(l.details)}</div>` : ''}</li>`).join('')}</ul>` : ''}

        ${btns.length ? `<div class="action-bar">${btns.join('')}</div>` : ''}`,
      onOpen: (wrap) => Pages.loadThumbs(wrap),
    });
  }

  // ---------------------------------------------------------------- اعتماد / استيضاح / رفض
  function review(id, decision) {
    const d = App.doc(id);
    const cfg = {
      approved: { title: 'اعتماد طلب السداد', btn: 'اعتماد', note: 'ملاحظة (اختياري)', req: false, notif: 'تم اعتماد طلب السداد', log: 'اعتماد' },
      clarification: { title: 'طلب استيضاح', btn: 'إرسال للمشتريات', note: 'المطلوب توضيحه', req: true, notif: 'مطلوب استيضاح على طلب سداد', log: 'طلب استيضاح' },
      rejected: { title: 'رفض طلب السداد', btn: 'رفض الطلب', note: 'سبب الرفض', req: true, notif: 'تم رفض طلب السداد', log: 'رفض' },
    }[decision];
    U.closeAll();
    U.modal({
      title: cfg.title,
      submitLabel: cfg.btn,
      danger: decision === 'rejected',
      body: `
        <p class="lead">${esc(App.docTitle(d))} — <b>${sar(Logic.effTotal(d))}</b></p>
        ${field(cfg.note, `<textarea name="note" rows="3" ${cfg.req ? 'required' : ''}></textarea>`, { req: cfg.req })}
        ${decision === 'approved' ? '<label class="check"><input type="checkbox" name="pay_now" checked> تسجيل الدفعة وإرفاق الإيصال الآن</label>' : ''}`,
      onSubmit: async (form) => {
        const v = U.formObj(form);
        await App.api.update('documents', d.id, {
          review_status: decision, review_note: v.note || null, reviewed_by: App.me.id, reviewed_at: new Date().toISOString(),
        });
        const label = `${App.docTitle(d)} — ${App.project(d.project_id).name}`;
        await App.log(cfg.log, v.note || label, d.project_id, d.id);
        await App.notify([d.created_by], { title: cfg.notif, body: v.note ? `${label}: ${v.note}` : label, project_id: d.project_id, document_id: d.id });
        U.toast(`${cfg.log} — تم إبلاغ المشتريات`);
        await App.refresh();
        if (v.pay_now) setTimeout(() => payment(d.id), 50);
      },
    });
  }

  // ---------------------------------------------------------------- تسجيل دفعة
  function payment(id) {
    const d = App.doc(id);
    const i = App.info(d);
    const suggested = i.dueNow > 0 ? i.dueNow : i.remaining;
    U.closeAll();
    U.modal({
      title: 'تسجيل دفعة',
      submitLabel: 'تسجيل الدفعة وإبلاغ المشتريات',
      body: `
        <p class="lead">${esc(App.docTitle(d))}</p>
        <div class="mini-kpis">
          <div><span>الإجمالي</span><b>${sar(i.total)}</b></div>
          <div><span>المسدد سابقاً</span><b>${sar(i.paid)}</b></div>
          <div><span>المطلوب (${pct(num(d.requested_percent), 0)})</span><b class="accent">${sar(i.dueNow)}</b></div>
          <div><span>المتبقي الكلي</span><b>${sar(i.remaining)}</b></div>
        </div>
        <div class="grid2">
          ${field('مبلغ الدفعة (شامل الضريبة)', moneyInput('amount', suggested.toFixed(2), `required min="0.01" max="${i.remaining}"`), { req: true })}
          ${field('النسبة من قيمة المستند %', `<input type="number" name="percent" step="0.01" min="0" max="100" value="${i.total ? round2((suggested / i.total) * 100) : ''}">`)}
          ${field('تاريخ السداد', `<input type="date" name="pay_date" required value="${U.today()}">`, { req: true })}
          ${field('طريقة السداد', `<select name="method">${Logic.PAY_METHODS.map((m) => opt(m, m)).join('')}</select>`)}
          ${field('رقم المرجع / الحوالة', '<input name="reference" maxlength="80">')}
          ${field('إيصال السداد', fileInput('files', true), { req: true })}
          ${field('ملاحظات', '<textarea name="notes" rows="2"></textarea>', { cls: 'span2' })}
        </div>`,
      onOpen: (wrap, form) => {
        const a = form.querySelector('[name=amount]');
        const p = form.querySelector('[name=percent]');
        a.addEventListener('input', () => { p.value = i.total ? round2((num(a.value) / i.total) * 100) : ''; });
        p.addEventListener('input', () => { a.value = round2((i.total * num(p.value)) / 100).toFixed(2); });
      },
      onSubmit: async (form) => {
        const v = U.formObj(form);
        const amount = round2(v.amount);
        if (amount <= 0) throw new Error('أدخل مبلغ الدفعة');
        if (amount > i.remaining + 0.005) throw new Error(`المبلغ أكبر من المتبقي (${money(i.remaining)} ر.س)`);
        const files = filesOf(form, 'files');
        if (!files.length) throw new Error('أرفق إيصال السداد');
        const payId = U.uuid();
        const pending = await App.storeFiles(files, { project_id: d.project_id, document_id: d.id, kind: 'receipt' });
        await App.api.insert('payments', {
          id: payId, document_id: d.id, project_id: d.project_id, amount, pay_date: v.pay_date,
          method: v.method, reference: v.reference || null, notes: v.notes || null, created_by: App.me.id,
        });
        await App.saveAttachments(pending, { payment_id: payId });

        const paidAfter = round2(i.paid + amount);
        const needTI = d.doc_type === 'quotation' && d.ti_total == null;
        const pctPaid = i.total ? (paidAfter / i.total) * 100 : 0;
        const pname = App.project(d.project_id).name;
        const body = `تم سداد ${money(amount)} ر.س لـ ${d.supplier_name} — ${pname}. إجمالي المسدد ${pct(pctPaid)} من قيمة المستند. إيصال السداد مرفق.${needTI ? ' برجاء رفع الفاتورة الضريبية.' : ''}`;
        await App.log('تسجيل دفعة', `${money(amount)} ر.س — ${v.method}${v.reference ? ' — ' + v.reference : ''}`, d.project_id, d.id);
        const procIds = App.usersWithRole('procurement').map((u) => u.id);
        const targets = App.db.profiles.some((u) => u.id === d.created_by && u.role === 'procurement') ? [d.created_by] : procIds;
        await App.notify(targets, { title: needTI ? 'تم السداد — مطلوب الفاتورة الضريبية' : 'تم السداد', body, project_id: d.project_id, document_id: d.id });
        U.toast('تم تسجيل الدفعة وإبلاغ المشتريات');
        await App.refresh();
      },
    });
  }

  // ---------------------------------------------------------------- رفع الفاتورة الضريبية لعرض سعر
  function taxInvoice(id) {
    const d = App.doc(id);
    const rate = App.vatRate();
    U.closeAll();
    U.modal({
      title: 'رفع الفاتورة الضريبية',
      submitLabel: 'رفع الفاتورة وإبلاغ المالية',
      body: `
        <p class="lead">مرتبطة بعرض السعر: ${esc(App.docTitle(d))} — ${sar(d.total_amount)}</p>
        <div class="grid2">
          ${field('رقم الفاتورة الضريبية', '<input name="ti_number" required maxlength="60">', { req: true })}
          ${field('تاريخ الفاتورة', `<input type="date" name="ti_date" required value="${U.today()}">`, { req: true })}
          ${field('المبلغ قبل الضريبة', moneyInput('ti_net', num(d.net_amount).toFixed(2), 'required min="0.01"'), { req: true })}
          ${field(`الضريبة (${rate}%)`, moneyInput('ti_vat', num(d.vat_amount).toFixed(2)))}
          ${field('الإجمالي', '<output class="big-out" data-total>—</output>')}
          ${field('الفرق عن عرض السعر', '<output class="big-out" data-diff>—</output>')}
          ${field('صورة الفاتورة الضريبية', fileInput('files', true), { req: true, cls: 'span2' })}
        </div>`,
      onOpen: (wrap, form) => {
        const n = form.querySelector('[name=ti_net]');
        const t = form.querySelector('[name=ti_vat]');
        let touched = false;
        const calc = () => {
          if (!touched && num(d.vat_amount) > 0) t.value = round2((num(n.value) * rate) / 100).toFixed(2);
          const total = round2(num(n.value) + num(t.value));
          const diff = round2(total - num(d.total_amount));
          form.querySelector('[data-total]').innerHTML = sar(total);
          form.querySelector('[data-diff]').innerHTML = Math.abs(diff) < 0.005 ? '<span class="good-text">✓ مطابق</span>' : `<span class="warn-text">${sar(diff)}</span>`;
        };
        n.addEventListener('input', calc);
        t.addEventListener('input', () => { touched = true; calc(); });
        calc();
      },
      onSubmit: async (form) => {
        const v = U.formObj(form);
        const net = round2(v.ti_net);
        const vat = round2(v.ti_vat);
        const files = filesOf(form, 'files');
        if (!files.length) throw new Error('أرفق صورة الفاتورة الضريبية');
        const pending = await App.storeFiles(files, { project_id: d.project_id, document_id: d.id, kind: 'tax_invoice' });
        await App.api.update('documents', d.id, {
          ti_number: v.ti_number, ti_date: v.ti_date, ti_net: net, ti_vat: vat, ti_total: round2(net + vat), ti_uploaded_at: new Date().toISOString(),
        });
        await App.saveAttachments(pending);
        const diff = round2(net + vat - num(d.total_amount));
        const body = `${v.ti_number} — ${d.supplier_name} — ${App.project(d.project_id).name}${Math.abs(diff) > 0.005 ? ` (فرق ${money(diff)} ر.س عن عرض السعر)` : ''}`;
        await App.log('رفع الفاتورة الضريبية', body, d.project_id, d.id);
        await App.notifyRole('finance', { title: 'تم رفع الفاتورة الضريبية', body, project_id: d.project_id, document_id: d.id });
        U.toast('تم رفع الفاتورة الضريبية');
        await App.refresh();
      },
    });
  }

  // ---------------------------------------------------------------- طلب دفعة إضافية
  function requestMore(id) {
    const d = App.doc(id);
    const i = App.info(d);
    U.closeAll();
    U.modal({
      title: 'طلب سداد دفعة إضافية',
      submitLabel: 'إرسال الطلب للمالية',
      body: `
        <p class="lead">${esc(App.docTitle(d))} — المسدد حتى الآن ${pct(i.paidPct)} (${sar(i.paid)})</p>
        ${field('النسبة الإجمالية المطلوب سدادها %', `<input type="number" name="requested_percent" required min="${round2(num(d.requested_percent) + 0.01)}" max="100" step="0.01" value="100">`, { req: true, hint: 'النسبة التراكمية من قيمة المستند (مثلاً 100% لسداد الباقي بالكامل)' })}
        ${field('ملاحظة', '<textarea name="note" rows="2"></textarea>')}`,
      onSubmit: async (form) => {
        const v = U.formObj(form);
        const p = round2(v.requested_percent);
        if (p <= num(d.requested_percent) || p > 100) throw new Error('النسبة يجب أن تكون أكبر من النسبة الحالية ولا تتعدى 100%');
        await App.api.update('documents', d.id, { requested_percent: p });
        const body = `${App.docTitle(d)} — ${App.project(d.project_id).name}: رفع نسبة السداد المطلوبة إلى ${p}%${v.note ? ' — ' + v.note : ''}`;
        await App.log('طلب دفعة إضافية', body, d.project_id, d.id);
        await App.notifyRole('finance', { title: 'طلب سداد دفعة إضافية', body, project_id: d.project_id, document_id: d.id });
        U.toast('تم إرسال الطلب للمالية');
        await App.refresh();
      },
    });
  }

  // ---------------------------------------------------------------- العرض المالي التقديري
  function budget(projectId) {
    const p = App.project(projectId);
    const items = App.db.budget_items.filter((b) => b.project_id === projectId);
    const byCat = new Map(items.map((b) => [b.category_id, b]));
    U.closeAll();
    U.modal({
      title: `العرض المالي التقديري — ${p.name}`,
      submitLabel: 'حفظ الميزانية',
      wide: true,
      body: `
        <p class="muted">أدخل التكلفة التقديرية <b>قبل الضريبة</b> لكل بند. اترك البند فاضي لو مش داخل في المشروع.</p>
        <div class="table-wrap"><table class="tbl budget-tbl">
          <thead><tr><th>البند</th><th>التكلفة التقديرية (ر.س)</th><th>وصف / ملاحظات</th></tr></thead>
          <tbody>${App.db.cost_categories.map((c) => {
            const b = byCat.get(c.id) || {};
            return `<tr><td><b>${esc(c.name)}</b></td>
              <td>${moneyInput(`amt_${c.id}`, b.amount != null ? num(b.amount).toFixed(2) : '', 'data-sum')}</td>
              <td><input name="desc_${c.id}" maxlength="200" value="${esc(b.description)}"></td></tr>`;
          }).join('')}</tbody>
          <tfoot><tr><th>الإجمالي</th><th><output data-sum-out>—</output></th><th></th></tr></tfoot>
        </table></div>
        ${field('إرفاق ملف العرض المالي (اختياري)', fileInput('files', false, 'image/*,application/pdf,.xlsx,.xls,.doc,.docx'))}`,
      onOpen: (wrap, form) => {
        const calc = () => {
          const t = [...form.querySelectorAll('[data-sum]')].reduce((s, el) => s + num(el.value), 0);
          form.querySelector('[data-sum-out]').innerHTML = sar(t);
        };
        form.addEventListener('input', calc);
        calc();
      },
      onSubmit: async (form) => {
        const v = U.formObj(form);
        const rows = App.db.cost_categories
          .map((c) => ({ project_id: projectId, category_id: c.id, amount: round2(v[`amt_${c.id}`]), description: v[`desc_${c.id}`] || null }))
          .filter((r) => r.amount > 0 || r.description);
        const pending = await App.storeFiles(filesOf(form, 'files'), { project_id: projectId, kind: 'budget' });
        await App.api.removeWhere('budget_items', { project_id: projectId });
        if (rows.length) await App.api.insert('budget_items', rows);
        await App.saveAttachments(pending);
        await App.log('تحديث العرض المالي التقديري', `الإجمالي ${money(U.sum(rows, (r) => r.amount))} ر.س`, projectId);
        U.toast('تم حفظ العرض المالي');
        await App.refresh();
      },
    });
  }

  function budgetFile(projectId) {
    U.modal({
      title: 'إرفاق ملف العرض المالي',
      submitLabel: 'رفع',
      body: field('الملف', fileInput('files', true, 'image/*,application/pdf,.xlsx,.xls,.doc,.docx'), { req: true }),
      onSubmit: async (form) => {
        const pending = await App.storeFiles(filesOf(form, 'files'), { project_id: projectId, kind: 'budget' });
        await App.saveAttachments(pending);
        U.toast('تم رفع الملف');
        await App.refresh();
      },
    });
  }

  // ---------------------------------------------------------------- الإعدادات
  function category(c) {
    const isEdit = !!c;
    c = c || { sort: App.db.cost_categories.length + 1 };
    U.modal({
      title: isEdit ? 'تعديل بند تكلفة' : 'بند تكلفة جديد',
      body: `<div class="grid2">
        ${field('اسم البند', `<input name="name" required maxlength="60" value="${esc(c.name)}">`, { req: true })}
        ${field('الترتيب', `<input type="number" name="sort" value="${esc(c.sort)}">`)}
      </div>`,
      onSubmit: async (form) => {
        const v = U.formObj(form);
        const row = { name: v.name, sort: num(v.sort) };
        if (isEdit) await App.api.update('cost_categories', c.id, row);
        else await App.api.insert('cost_categories', { id: U.uuid(), ...row });
        await App.refresh();
      },
    });
  }

  function vat() {
    U.modal({
      title: 'نسبة ضريبة القيمة المضافة',
      body: field('النسبة %', `<input type="number" name="rate" required min="0" max="100" step="0.01" value="${App.vatRate()}">`, { req: true, hint: 'تطبق على المستندات الجديدة فقط' }),
      onSubmit: async (form) => {
        await App.api.setSetting('vat_rate', round2(U.formObj(form).rate));
        U.toast('تم الحفظ');
        await App.refresh();
      },
    });
  }

  // ---------------------------------------------------------------- إدارة المستخدمين
  const genPassword = () => {
    const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%&*!'];
    const all = sets.join('');
    const r = new Uint32Array(12);
    crypto.getRandomValues(r);
    const chars = [...r].map((x, i) => (i < sets.length ? sets[i] : all)[x % (i < sets.length ? sets[i] : all).length]);
    for (let i = chars.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    return chars.join('');
  };

  const pwInput = (name, label) => `
    <label class="field"><span class="lbl">${label} <b class="req">*</b></span>
      <span class="pw-wrap">
        <input type="password" name="${name}" required minlength="6" autocomplete="new-password" dir="ltr">
        <button type="button" class="pw-eye" data-eye aria-label="إظهار كلمة المرور">👁</button>
      </span>
      <span class="hint"><button type="button" class="link" data-gen="${name}">⚄ توليد كلمة مرور قوية</button> · 6 أحرف على الأقل</span>
    </label>
    <div class="pw-meter" data-meter="${name}" data-score="-1"><i></i><i></i><i></i><i></i><span></span></div>`;

  const bindGen = (form) => {
    Pages.bindPwUi(form);
    form.querySelectorAll('[data-gen]').forEach((b) => b.addEventListener('click', () => {
      const i = form.querySelector(`[name="${b.dataset.gen}"]`);
      i.value = genPassword();
      i.type = 'text';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }));
  };

  function credentials(title, email, password) {
    const link = location.origin + location.pathname;
    const text = `رابط النظام: ${link}\nالبريد: ${email}\nكلمة المرور: ${password}`;
    U.modal({
      title,
      body: `
        <p>شارك البيانات دي مع المستخدم — <b>كلمة المرور مش هتظهر تاني</b>.</p>
        <div class="cred-box" dir="ltr">
          <div><span>Link</span><code>${esc(link)}</code></div>
          <div><span>Email</span><code>${esc(email)}</code></div>
          <div><span>Password</span><code>${esc(password)}</code></div>
        </div>
        <div class="row-btns"><button type="button" class="btn primary" data-copy>📋 نسخ البيانات</button><button type="button" class="btn ghost" data-close>تم</button></div>`,
      onOpen: (wrap) => {
        wrap.querySelector('[data-copy]').addEventListener('click', async (e) => {
          try { await navigator.clipboard.writeText(text); e.target.textContent = '✓ تم النسخ'; } catch (err) { U.toast('انسخ البيانات يدوياً', 'err'); }
        });
      },
    });
  }

  const ROLE_OPTS = ['procurement', 'finance', 'management'];

  function user(u) {
    const isEdit = !!u;
    u = u || { role: 'procurement' };
    const self = isEdit && u.id === App.me.id;
    const roles = isEdit ? [...ROLE_OPTS, 'pending', 'disabled'] : ROLE_OPTS;
    U.modal({
      title: isEdit ? `تعديل المستخدم — ${u.full_name || u.email}` : 'إضافة مستخدم جديد',
      submitLabel: isEdit ? 'حفظ' : 'إنشاء الحساب',
      body: `
        <div class="grid2">
          ${field('الاسم الكامل', `<input name="full_name" required maxlength="80" value="${esc(u.full_name)}">`, { req: true })}
          ${field('البريد الإلكتروني (اسم الدخول)', `<input type="email" name="email" required dir="ltr" value="${esc(u.email)}">`, { req: true })}
        </div>
        <fieldset class="role-pick" ${self ? 'disabled' : ''}><legend>الدور ${self ? '<small class="muted">(لا يمكنك تغيير دورك)</small>' : ''}</legend>
          ${roles.map((r) => `<label class="role-opt"><input type="radio" name="role" value="${r}" ${u.role === r ? 'checked' : ''}>
            <span><b>${Logic.ROLES[r]}</b><small>${{
              procurement: 'ينشئ مشاريع ويرفع الفواتير وعروض الأسعار ويتابع السداد',
              finance: 'مدير النظام: يعتمد ويسدد ويرفع الإيصالات ويدير المستخدمين',
              management: 'مشاهدة لوحة التحكم والتقارير فقط',
              pending: 'بدون صلاحيات لحين التفعيل',
              disabled: 'ممنوع من الدخول',
            }[r]}</small></span></label>`).join('')}
        </fieldset>
        ${isEdit ? '' : pwInput('password', 'كلمة المرور')}`,
      onOpen: (wrap, form) => bindGen(form),
      onSubmit: async (form) => {
        const v = U.formObj(form);
        const role = self ? u.role : v.role;
        if (isEdit) {
          await App.api.rpc('admin_update_user', { p_user_id: u.id, p_full_name: v.full_name, p_email: v.email, p_role: role });
          await App.log('تعديل مستخدم', `${v.full_name} — ${Logic.ROLES[role]}`);
          U.toast('تم حفظ بيانات المستخدم');
          await App.refresh();
        } else {
          await App.api.rpc('admin_create_user', { p_email: v.email, p_password: v.password, p_full_name: v.full_name, p_role: role });
          await App.log('إضافة مستخدم', `${v.full_name} — ${Logic.ROLES[role]}`);
          await App.refresh();
          setTimeout(() => credentials('تم إنشاء الحساب ✓', v.email.toLowerCase(), v.password), 50);
        }
      },
    });
  }

  function userPassword(u) {
    const self = u.id === App.me.id;
    U.modal({
      title: self ? 'تغيير كلمة المرور' : `تعيين كلمة مرور — ${u.full_name || u.email}`,
      submitLabel: 'حفظ كلمة المرور',
      body: `${self ? '' : '<p class="muted">كلمة المرور القديمة هتتلغي فوراً.</p>'}${pwInput('password', 'كلمة المرور الجديدة')}`,
      onOpen: (wrap, form) => bindGen(form),
      onSubmit: async (form) => {
        const pw = U.formObj(form).password;
        if (self && App.api.mode === 'supabase') await App.api.updatePassword(pw);
        else await App.api.rpc('admin_set_password', { p_user_id: u.id, p_password: pw });
        await App.log(self ? 'تغيير كلمة المرور' : 'تعيين كلمة مرور لمستخدم', u.full_name || u.email);
        if (self) U.toast('تم تغيير كلمة المرور');
        else setTimeout(() => credentials('تم تعيين كلمة المرور ✓', u.email, pw), 50);
      },
    });
  }

  function newPassword() {
    U.modal({
      title: 'تعيين كلمة مرور جديدة',
      body: field('كلمة المرور الجديدة', '<input type="password" name="pw" required minlength="6" autocomplete="new-password">', { req: true }),
      onSubmit: async (form) => {
        await App.api.updatePassword(U.formObj(form).pw);
        U.toast('تم تغيير كلمة المرور');
      },
    });
  }

  return { project, document: docForm, docDetails, review, payment, taxInvoice, requestMore, budget, budgetFile, category, vat, newPassword, user, userPassword };
})();
