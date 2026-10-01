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
    completed: { label: 'مكتمل', cls: 'good', icon: '✓' },
  };

  const PAY_METHODS = ['تحويل بنكي', 'شيك', 'نقدي', 'سداد إلكتروني'];
  const PROJECT_STATUS = { active: 'جاري', on_hold: 'متوقف', completed: 'منتهي' };

  const hasTI = (d) => d.doc_type === 'tax_invoice' || d.ti_total != null;
  const effNet = (d) => (d.ti_total != null ? num(d.ti_net) : num(d.net_amount));
  const effVat = (d) => (d.ti_total != null ? num(d.ti_vat) : num(d.vat_amount));
  const effTotal = (d) => (d.ti_total != null ? num(d.ti_total) : num(d.total_amount));
  const requestedAmount = (d) => round2(effTotal(d) * num(d.requested_percent) / 100);

  const paidOf = (d, payments) => round2(sum(payments.filter((p) => p.document_id === d.id), (p) => p.amount));

  function statusKey(d, paid) {
    if (d.review_status !== 'approved') return d.review_status;
    const total = effTotal(d);
    if (paid >= total - EPS && total > 0) return hasTI(d) ? 'completed' : 'awaiting_ti';
    if (paid > EPS) return 'partial';
    return 'approved';
  }

  // تحسب كل المؤشرات اللي محتاجها أي شاشة لمستند واحد
  function docInfo(d, payments) {
    const paid = paidOf(d, payments);
    const total = effTotal(d);
    const requested = requestedAmount(d);
    const key = statusKey(d, paid);
    return {
      paid,
      total,
      net: effNet(d),
      vat: effVat(d),
      requested,
      remaining: round2(Math.max(0, total - paid)),
      dueNow: d.review_status === 'approved' ? round2(Math.max(0, requested - paid)) : 0,
      paidPct: total > 0 ? (paid / total) * 100 : 0,
      status: key,
      st: STATUS[key] || STATUS.new,
      // المالية مطلوب منها تتصرف
      needsReview: d.review_status === 'new',
      needsPayment: d.review_status === 'approved' && paid < requested - EPS,
      // المشتريات مطلوب منها تتصرف
      needsTI: d.doc_type === 'quotation' && d.ti_total == null && d.review_status === 'approved' && paid > EPS,
      needsFix: d.review_status === 'clarification' || d.review_status === 'rejected',
      canRequestMore: d.review_status === 'approved' && num(d.requested_percent) < 100 && paid >= requested - EPS && paid < total - EPS,
      tiDiff: d.ti_total != null ? round2(num(d.ti_total) - num(d.total_amount)) : 0,
    };
  }

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
          budget: 0, committed: 0, paid: 0, pending: 0, committedGross: 0, paidGross: 0, vat: 0, docs: 0,
        });
      }
      return rows.get(k);
    };

    db.budget_items.filter((b) => b.project_id === projectId).forEach((b) => { row(b.category_id).budget += num(b.amount); });
    const pays = db.payments.filter((p) => p.project_id === projectId);
    db.documents.filter((d) => d.project_id === projectId).forEach((d) => {
      const r = row(d.category_id);
      if (d.review_status === 'approved') {
        const paid = paidOf(d, pays);
        const net = effNet(d);
        const tot = effTotal(d);
        r.committed += net;
        r.committedGross += tot;
        r.vat += effVat(d);
        r.paidGross += paid;
        r.paid += tot > 0 ? (paid * net) / tot : 0;
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
      o.state = usageState(o.budget, o.committed);
      return o;
    }).sort((a, b) => a.sort - b.sort);

    const t = {};
    ['budget', 'committed', 'paid', 'pending', 'committedGross', 'paidGross', 'vat'].forEach((k) => { t[k] = round2(sum(list, (r) => r[k])); });
    t.docs = sum(list, (r) => r.docs);
    t.variance = round2(t.budget - t.committed);
    t.usage = t.budget > 0 ? (t.committed / t.budget) * 100 : null;
    t.remainingGross = round2(t.committedGross - t.paidGross);
    t.state = usageState(t.budget, t.committed);
    return { rows: list, totals: t };
  }

  return { ROLES, TYPES, STATUS, PAY_METHODS, PROJECT_STATUS, hasTI, effNet, effVat, effTotal, paidOf, docInfo, projectCost, usageState };
})();
