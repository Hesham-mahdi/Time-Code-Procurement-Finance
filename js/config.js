// إعدادات الاتصال بـ Supabase
// المفتاح العام (anon public) آمن للنشر — الحماية الفعلية عن طريق صلاحيات RLS في قاعدة البيانات.
// لا تضع مفتاح service_role هنا أبداً.
// لو المفتاح فاضي، الموقع بيشتغل في "الوضع التجريبي" والبيانات بتتحفظ على المتصفح فقط.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://tohdmouyjyfobvkovvmy.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_fs-M7c5phwo2eH9T7APUHA_wFPK3iOe',
  STORAGE_BUCKET: 'files',
  MAX_FILE_MB: 10,
};
