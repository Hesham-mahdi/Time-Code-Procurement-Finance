'use strict';

// قواعد العمل: حالات المستندات وحسابات مركز التكلفة
const Logic = (() => {
  const { num, round2, sum } = U;
  const EPS = 0.005;

  const ROLES = {
    finance: 'المالية — مدير النظام',
    procurement: 'مدير المشتريات',
    management: 'الإدارة (مشاهدة)',
    pending: 'بانتظار التفعيل',
    disabled: 'موقوف',
  };

  const TYPES = { tax_invoice: 'فاتورة ضريبية', quotation: 'عرض سعر' };

  const STATUS = {
    new: { label: 'جديد — بانتظار المراجعة', cls: 'info', icon: '●' },
    clarification: { label: 'مطلوب استيضاح', cls: 'warn', icon: '?' },
    rejected: { label: 'مرفوض', cls: 'bad', icon: '✕' },
    approved: { label: 'معتمد — بانتظار السداد', cls: 'blue', icon: '◷' },
    partial: { label: 'مسدد جزئياً', cls: 'blue', icon: '◑' },
    awaiting_ti: { label: 'بانتظار الفاتورة الضريبية', cls: 'warn', icon: '⧗' },
    retention: { label: 'مسدد — محتجز ضمان', cls: 'good', icon: '◔' },
    completed: { label: 'مكتمل', cls: 'good', icon: '✓' },
  };

  const PAY_METHODS = ['تحويل بنكي', 'شيك', 'نقدي', 'سداد إلكتروني'];
  const PROJECT_STATUS = { active: 'جاري', on_hold: 'متوقف', completed: 'منتهي' };

  // الفواتير الضريبية المرتبطة بعروض الأسعار (App بيحدثها بعد كل تحميل)
  let TIS = [];
  const setTaxInvoices = (list) => { TIS = list || []; };
  const tisOf = (d) => (d.doc_type === 'quotation' ? TIS.filter((t) => t.document_id === d.id) : []);

  // قيم المستند الفعلية:
  // - فاتورة ضريبية مباشرة: قيمتها.
  // - عرض سعر قبل الفاتورة النهائية: قيمة العرض (التزام)، والمفوتر = مجموع فواتير الدفعات.
  // - عرض سعر بعد الفاتورة النهائية: مجموع كل الفواتير الضريبية (النهائية بتخصم الدفعات المقدمة).
  function amounts(d) {
    if (d.doc_type !== 'quotation') {
      const n = num(d.net_amount); const v = num(d.vat_amount); const t = num(d.total_amount);
      return { net: n, vat: v, total: t, invNet: n, invVat: v, invTotal: t, final: true, tis: [] };
    }
    const list = tisOf(d);
    const invNet = round2(sum(list, (t) => t.net_amount));
    const invVat = round2(sum(list, (t) => t.vat_amount));
    const invTotal = round2(sum(list, (t) => t.total_amount));
    if (list.some((t) => t.is_final)) return { net: invNet, vat: invVat, total: invTotal, invNet, invVat, invTotal, final: true, tis: list };
    return { net: num(d.net_amount), vat: num(d.vat_amount), total: num(d.total_amount), invNet, invVat, invTotal, final: false, tis: list };
  }
  const hasTI = (d) => amounts(d).final;
  const effNet = (d) => amounts(d).net;
  const effVat = (d) => amounts(d).vat;
  const effTotal = (d) => amounts(d).total;
  // المحتجز (ضمان حسن التنفيذ) بيتحجز لحد ما المالية تفرج عنه — والضريبة بتتحسب على كامل القيمة شاملة المحتجز
  const retentionOf = (d) => round2(effTotal(d) * num(d.retention_percent) / 100);
  const heldRetention = (d) => (d.retention_released_at ? 0 : retentionOf(d));
  const payableNow = (d) => round2(effTotal(d) - heldRetention(d));
  const requestedAmount = (d) => round2(Math.min(effTotal(d) * num(d.requested_percent) / 100, payableNow(d)));

  const paidOf = (d, payments) => round2(sum(payments.filter((p) => p.document_id === d.id), (p) => p.amount));

  function statusKey(d, paid, a) {
    if (d.review_status !== 'approved') return d.review_status;
    const total = a.total;
    const invoicedEnough = a.final || a.invTotal >= paid - EPS;
    if (total > 0 && paid >= total - EPS) return invoicedEnough && a.final ? 'completed' : 'awaiting_ti';
    if (total > 0 && heldRetention(d) > 0 && paid >= payableNow(d) - EPS) return a.final ? 'retention' : 'awaiting_ti';
    if (paid > EPS) return 'partial';
    return 'approved';
  }

  const todayStr = () => U.today();

  // تحسب كل المؤشرات اللي محتاجها أي شاشة لمستند واحد
  function docInfo(d, payments) {
    const a = amounts(d);
    const paid = paidOf(d, payments);
    const total = a.total;
    const requested = requestedAmount(d);
    const key = statusKey(d, paid, a);
    const approved = d.review_status === 'approved';
    const dueNow = approved ? round2(Math.max(0, requested - paid)) : 0;
    const overdueDays = dueNow > EPS && d.due_date && d.due_date < todayStr() ? U.daysBetween(d.due_date, todayStr()) : 0;
    // المبلغ المسدد اللي لسه ما اتصدرش عنه فاتورة ضريبية (كل دفعة نقطة استحقاق ضريبي)
    const uninvoiced = d.doc_type === 'quotation' ? round2(Math.max(0, paid - a.invTotal)) : 0;
    const qRate = num(d.total_amount) > 0 ? num(d.vat_amount) / num(d.total_amount) : 0;
    const lastPay = payments.filter((p) => p.document_id === d.id).map((p) => p.pay_date).sort().pop();
    return {
      paid,
      total,
      net: a.net,
      vat: a.vat,
      invTotal: a.invTotal,
      invVat: a.invVat,
      final: a.final,
      tis: a.tis,
      uninvoiced,
      requested,
      retention: retentionOf(d),
      retentionHeld: heldRetention(d),
      payable: payableNow(d),
      remaining: round2(Math.max(0, total - paid)),
      dueNow,
      overdueDays,
      paidPct: total > 0 ? (paid / total) * 100 : 0,
      status: key,
      st: STATUS[key] || STATUS.new,
      // ضريبة المدخلات: قابلة للاسترداد بس بعد استلام فاتورة ضريبية
      vatRecoverable: approved ? a.invVat : 0,
      vatBlocked: approved ? round2(uninvoiced * qRate) : 0,
      tiWaitDays: uninvoiced > EPS && lastPay ? U.daysBetween(lastPay, todayStr()) : 0,
      // المالية مطلوب منها تتصرف
      needsReview: d.review_status === 'new',
      needsPayment: approved && paid < requested - EPS,
      canRelease: approved && heldRetention(d) > 0 && paid >= payableNow(d) - EPS,
      // المشتريات مطلوب منها تتصرف
      needsTI: approved && d.doc_type === 'quotation' && (uninvoiced > EPS || (paid >= total - EPS && total > 0 && !a.final)),
      needsFix: d.review_status === 'clarification' || d.review_status === 'rejected',
      canRequestMore: approved && num(d.requested_percent) < 100 && paid >= requested - EPS && paid < payableNow(d) - EPS,
      tiDiff: d.doc_type === 'quotation' && a.final ? round2(a.total - num(d.total_amount)) : 0,
    };
  }

  // المدة بالأيام في كل مرحلة من الدورة (لقياس الكفاءة)
  function cycleTimes(d, payments) {
    const pays = payments.filter((p) => p.document_id === d.id).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
    const firstTI = tisOf(d).map((t) => t.created_at).sort()[0];
    return {
      reviewDays: d.reviewed_at ? U.daysBetween(d.created_at, d.reviewed_at) : null,
      payDays: d.reviewed_at && pays.length ? U.daysBetween(d.reviewed_at, pays[0].created_at) : null,
      tiDays: firstTI && pays.length ? U.daysBetween(pays[0].created_at, firstTI) : null,
      totalDays: pays.length ? U.daysBetween(d.created_at, pays[0].created_at) : null,
    };
  }
  // أعمار المستحقات حسب تاريخ الاستحقاق
  const AGING = [
    { key: 'current', label: 'لم يستحق بعد' },
    { key: 'd30', label: 'متأخر 1–30 يوم' },
    { key: 'd60', label: 'متأخر 31–60 يوم' },
    { key: 'd90', label: 'متأخر 61–90 يوم' },
    { key: 'd90p', label: 'متأخر أكثر من 90 يوم' },
    { key: 'nodate', label: 'بدون تاريخ استحقاق' },
  ];
  const agingBucket = (d, i) => {
    if (!d.due_date) return 'nodate';
    if (!i.overdueDays) return 'current';
    if (i.overdueDays <= 30) return 'd30';
    if (i.overdueDays <= 60) return 'd60';
    if (i.overdueDays <= 90) return 'd90';
    return 'd90p';
  };
  function usageState(budget, committed) {
    if (budget <= 0 && committed <= 0) return null;
    if (budget <= 0) return { cls: 'bad', icon: '▲', label: 'بدون ميزانية' };
    const u = (committed / budget) * 100;
    if (u > 100 + 1e-9) return { cls: 'bad', icon: '▲', label: 'تجاوز الميزانية' };
    if (u >= 90) return { cls: 'warn', icon: '!', label: 'قريب من الحد' };
    return { cls: 'good', icon: '✓', label: 'ضمن الميزانية' };
  }

  // مركز التكلفة لمشروع: تقديري / ملتزم / مسدد — كله قبل الضريبة
  function projectCost(projectId, db) {
    const catName = new Map(db.cost_categories.map((c) => [c.id, c.name]));
    const catSort = new Map(db.cost_categories.map((c) => [c.id, num(c.sort)]));
    const rows = new Map();
    const row = (cid) => {
      const k = cid && catName.has(cid) ? cid : '_none';
      if (!rows.has(k)) {
        rows.set(k, {
          id: k, name: k === '_none' ? 'غير مصنف' : catName.get(k), sort: k === '_none' ? 9999 : catSort.get(k),
          original: 0, revisions: 0, budget: 0, committed: 0, invoiced: 0, paid: 0, pending: 0, committedGross: 0, paidGross: 0, vat: 0, retention: 0, vatBlocked: 0, docs: 0,
        });
      }
      return rows.get(k);
    };

    db.budget_items.filter((b) => b.project_id === projectId).forEach((b) => { const r = row(b.category_id); r.original += num(b.amount); r.budget += num(b.amount); });
    (db.budget_revisions || []).filter((b) => b.project_id === projectId).forEach((b) => { const r = row(b.category_id); r.revisions += num(b.amount); r.budget += num(b.amount); });
    const pays = db.payments.filter((p) => p.project_id === projectId);
    db.documents.filter((d) => d.project_id === projectId).forEach((d) => {
      const r = row(d.category_id);
      if (d.review_status === 'approved') {
        const paid = paidOf(d, pays);
        const net = effNet(d);
        const tot = effTotal(d);
        r.committed += net;
        const am = amounts(d);
        r.invoiced += am.invNet;
        r.committedGross += tot;
        r.vat += effVat(d);
        r.paidGross += paid;
        r.paid += tot > 0 ? (paid * net) / tot : 0;
        r.retention += heldRetention(d);
        r.vatBlocked += d.doc_type === 'quotation' && num(d.total_amount) > 0 ? (Math.max(0, paid - am.invTotal) * num(d.vat_amount)) / num(d.total_amount) : 0;
        r.docs += 1;
      } else if (d.review_status === 'new' || d.review_status === 'clarification') {
        r.pending += effNet(d);
      }
    });

    const list = [...rows.values()].map((r) => {
      const o = {};
      Object.keys(r).forEach((k) => { o[k] = typeof r[k] === 'number' && !['sort', 'docs'].includes(k) ? round2(r[k]) : r[k]; });
      o.variance = round2(o.budget - o.committed);
      o.usage = o.budget > 0 ? (o.committed / o.budget) * 100 : null;
      o.forecast = round2(Math.max(o.committed + o.pending, o.invoiced));
      o.remainingToCommit = round2(o.budget - o.committed);
      o.state = usageState(o.budget, o.committed);
      return o;
    }).sort((a, b) => a.sort - b.sort);

    const t = {};
    ['original', 'revisions', 'budget', 'committed', 'invoiced', 'paid', 'pending', 'committedGross', 'paidGross', 'vat', 'retention', 'vatBlocked'].forEach((k) => { t[k] = round2(sum(list, (r) => r[k])); });
    t.docs = sum(list, (r) => r.docs);
    t.variance = round2(t.budget - t.committed);
    t.usage = t.budget > 0 ? (t.committed / t.budget) * 100 : null;
    t.remainingGross = round2(t.committedGross - t.paidGross);
    // المتوقع عند الإنجاز = الملتزم به + اللي تحت المراجعة
    t.forecast = round2(Math.max(t.committed + t.pending, t.invoiced));
    t.forecastVariance = round2(t.budget - t.forecast);
    t.state = usageState(t.budget, t.committed);
    return { rows: list, totals: t };
  }

  // المتبقي من ميزانية البند قبل اعتماد مستند جديد عليه
  function categoryRoom(d, db) {
    const c = projectCost(d.project_id, db);
    const key = d.category_id && db.cost_categories.some((x) => x.id === d.category_id) ? d.category_id : '_none';
    const r = c.rows.find((x) => x.id === key) || { budget: 0, committed: 0, name: 'غير مصنف' };
    const net = effNet(d);
    const room = round2(r.budget - r.committed);
    return { name: r.name, budget: r.budget, committed: r.committed, room, net, after: round2(room - net), over: net > room + EPS, noBudget: r.budget <= 0 };
  }

  return { setTaxInvoices, amounts, tisOf, categoryRoom, ROLES, TYPES, STATUS, PAY_METHODS, PROJECT_STATUS, AGING, hasTI, effNet, effVat, effTotal, paidOf, docInfo, projectCost, usageState, cycleTimes, agingBucket };
})();
