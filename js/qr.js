'use strict';

// قراءة رمز QR الخاص بالفاتورة الإلكترونية (هيئة الزكاة والضريبة والجمارك — فاتورة)
// الرمز بيحتوي على TLV مشفر Base64:  1 اسم البائع · 2 الرقم الضريبي · 3 التاريخ والوقت · 4 الإجمالي شامل الضريبة · 5 مبلغ الضريبة
const QR = (() => {
  let loading = null;
  const load = () => {
    if (window.jsQR) return Promise.resolve();
    if (!loading) {
      loading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
        s.onload = res;
        s.onerror = () => { loading = null; rej(new Error('تعذر تحميل قارئ QR')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  };

  async function decodeImage(file) {
    await load();
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      // نجرب أكتر من مقاس لأن صور الموبايل بتكون كبيرة أو الرمز صغير
      for (const max of [1400, 2200, 900]) {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
        if (code && code.data) return code.data;
      }
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function parseTLV(text) {
    let bytes;
    try {
      const bin = atob(String(text).trim());
      bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch (e) {
      return null;
    }
    const out = {};
    const dec = new TextDecoder();
    let i = 0;
    while (i + 2 <= bytes.length) {
      const tag = bytes[i];
      const len = bytes[i + 1];
      i += 2;
      if (i + len > bytes.length) break;
      if (tag >= 1 && tag <= 5) out[tag] = dec.decode(bytes.slice(i, i + len));
      i += len;
    }
    if (!out[2] || !out[4] || !Number.isFinite(Number(out[4]))) return null;
    const total = U.round2(Number(out[4]));
    const vat = U.round2(Number(out[5] || 0));
    return {
      seller: (out[1] || '').trim(),
      vatNo: out[2].trim(),
      date: /^\d{4}-\d{2}-\d{2}/.test(out[3] || '') ? out[3].slice(0, 10) : '',
      total,
      vat,
      net: U.round2(total - vat),
    };
  }

  // يرجع بيانات الفاتورة أو null لو مفيش رمز صالح في الصورة
  async function readInvoice(file) {
    if (!file || !U.isImage(file.type, file.name)) return null;
    try {
      const text = await decodeImage(file);
      return text ? parseTLV(text) : null;
    } catch (e) {
      console.warn('QR read failed', e);
      return null;
    }
  }

  return { readInvoice, parseTLV };
})();
