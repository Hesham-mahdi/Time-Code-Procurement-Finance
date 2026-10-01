'use strict';

// أدوات عامة: تنسيق، نوافذ، تنبيهات
const U = (() => {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  const num = (v) => {
    const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
  const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => nf.format(round2(n));
  const sar = (n) => `<span class="amt">${money(n)}</span> <span class="cur">ر.س</span>`;
  const pct = (n, d = 1) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(d)}%`);
  const sum = (arr, fn) => arr.reduce((s, x) => s + num(fn ? fn(x) : x), 0);

  const date = (d) => (d ? String(d).slice(0, 10) : '—');
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const dt = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const ago = (ts) => {
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'الآن';
    if (s < 3600) return `منذ ${Math.floor(s / 60)} دقيقة`;
    if (s < 86400) return `منذ ${Math.floor(s / 3600)} ساعة`;
    if (s < 86400 * 30) return `منذ ${Math.floor(s / 86400)} يوم`;
    return date(ts);
  };

  const uuid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

  const ERRORS = [
    [/Invalid login credentials/i, 'البريد الإلكتروني أو كلمة المرور غير صحيحة'],
    [/Email not confirmed/i, 'لم يتم تأكيد البريد الإلكتروني بعد — افتح رسالة التأكيد على بريدك'],
    [/already registered/i, 'هذا البريد مسجل بالفعل'],
    [/Password should be at least/i, 'كلمة المرور يجب ألا تقل عن 6 أحرف'],
    [/row-level security|permission denied|not allowed/i, 'ليس لديك صلاحية لتنفيذ هذا الإجراء'],
    [/Failed to fetch|NetworkError/i, 'تعذر الاتصال بالخادم — تحقق من الإنترنت'],
    [/User is banned/i, 'هذا الحساب موقوف — تواصل مع مدير النظام'],
    [/rate limit/i, 'محاولات كثيرة — انتظر قليلاً ثم حاول مرة أخرى'],
    [/exceeded the maximum allowed size|Payload too large/i, 'حجم الملف أكبر من المسموح'],
  ];
  const errMsg = (e) => {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e || 'حدث خطأ غير متوقع');
    const hit = ERRORS.find(([re]) => re.test(m));
    return hit ? hit[1] : m;
  };

  // ---- تنبيهات منبثقة ----
  const toast = (msg, type = 'ok', ms = 3800) => {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-ico" aria-hidden="true">${type === 'err' ? '!' : type === 'info' ? '🔔' : '✓'}</span><span>${esc(msg)}</span>`;
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  };

  // ---- نوافذ ----
  const modals = [];
  const closeAll = () => [...modals].forEach((m) => m.close());

  function modal({ title, body, submitLabel = 'حفظ', cancelLabel = 'إلغاء', onSubmit, wide = false, onOpen, danger = false }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <form class="modal-form" novalidate autocomplete="off">
          <div class="modal-head">
            <h3>${esc(title)}</h3>
            <button type="button" class="icon-btn" data-close aria-label="إغلاق">✕</button>
          </div>
          <div class="modal-body">${body}</div>
          <div class="modal-error" role="alert" hidden></div>
          ${onSubmit ? `<div class="modal-foot">
            <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>
            <button type="button" class="btn ghost" data-close>${esc(cancelLabel)}</button>
          </div>` : ''}
        </form>
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('modal-open');
    const form = wrap.querySelector('form');
    const errBox = wrap.querySelector('.modal-error');
    const onKey = (e) => { if (e.key === 'Escape' && modals[modals.length - 1] === api) close(); };
    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      const i = modals.indexOf(api);
      if (i >= 0) modals.splice(i, 1);
      if (!modals.length) document.body.classList.remove('modal-open');
    };
    const api = { el: wrap, form, close, error: (m) => { errBox.textContent = m; errBox.hidden = !m; } };
    modals.push(api);
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || (e.target === wrap && !onSubmit)) close();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return;
      api.error('');
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      btn.classList.add('loading');
      try {
        const r = await onSubmit(form, api);
        if (r !== false) close();
      } catch (ex) {
        console.error(ex);
        api.error(errMsg(ex));
      } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    });
    if (onOpen) onOpen(wrap, form, api);
    setTimeout(() => {
      const f = form.querySelector('[autofocus]') || form.querySelector('.modal-body input:not([type=hidden]):not([readonly]),.modal-body select,.modal-body textarea');
      if (f) f.focus();
    }, 40);
    return api;
  }

  const confirm = (message, { title = 'تأكيد', okLabel = 'تأكيد', danger = true } = {}) =>
    new Promise((resolve) => {
      let ok = false;
      const m = modal({
        title, submitLabel: okLabel, danger,
        body: `<p class="confirm-text">${esc(message)}</p>`,
        onSubmit: () => { ok = true; },
      });
      const obs = new MutationObserver(() => {
        if (!document.body.contains(m.el)) { obs.disconnect(); resolve(ok); }
      });
      obs.observe(document.body, { childList: true });
    });

  const formObj = (form) => {
    const o = {};
    new FormData(form).forEach((v, k) => {
      if (v instanceof File) return;
      o[k] = typeof v === 'string' ? v.trim() : v;
    });
    return o;
  };

  // ---- تلميح عائم للرسوم البيانية ----
  function initTooltip() {
    const tip = document.getElementById('tooltip');
    const show = (el, x, y) => {
      tip.innerHTML = el.dataset.tip;
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      let left = x - r.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
      let top = y - r.height - 14;
      if (top < 8) top = y + 18;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    document.addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el) show(el, e.clientX, e.clientY);
      else tip.hidden = true;
    });
    document.addEventListener('focusin', (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.top);
    });
    document.addEventListener('focusout', () => { tip.hidden = true; });
    window.addEventListener('scroll', () => { tip.hidden = true; }, true);
  }

  const fileSafeName = (name) => {
    const ext = (String(name).match(/\.([a-z0-9]{1,8})$/i) || [, 'bin'])[1].toLowerCase();
    return `${uuid()}.${ext}`;
  };

  const isImage = (mime, name) => /^image\//.test(mime || '') || /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(name || '');

  return {
    esc, num, round2, money, sar, pct, sum, date, today, dt, ago, uuid, errMsg,
    toast, modal, confirm, closeAll, formObj, initTooltip, fileSafeName, isImage,
  };
})();
