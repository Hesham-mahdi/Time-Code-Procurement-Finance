# البحث والتطوير — إزاي الأنظمة العالمية بتحل نفس المشكلة

ملخص البحث اللي اتبنى عليه الإصدار 2. المصادر الرسمية في الآخر.

---

## 1. دورة الشراء للسداد (Procure-to-Pay) في الأنظمة الكبيرة

الدورة الكاملة في **Coupa / SAP Ariba / Oracle**:
طلب شراء ← اعتماد ← أمر شراء (التزام) ← استلام ← فاتورة ← مطابقة ← اعتماد السداد ← سداد ← تسوية.

**اللي طبقناه لشركة بحجم Time Code:**
| في الأنظمة الكبيرة | عندنا |
|---|---|
| أمر الشراء (PO) = التزام | **عرض السعر المعتمد** هو الالتزام |
| دفعة مقدمة على PO (Precoro / Oracle Prepayments) | **دفعة على عرض سعر** |
| مطابقة الفاتورة بالـ PO | **الفاتورة الضريبية مربوطة بعرض السعر** والفرق بيظهر تلقائياً |
| منع الفاتورة المكررة (Oracle Duplicate Hold) | **تحذير تكرار**: نفس المورد + نفس الرقم، أو نفس المبلغ والتاريخ |
| فصل الصلاحيات | المشتريات ما تقدرش تعتمد، والسداد للمالية بس — **على مستوى قاعدة البيانات** |

## 2. نموذج الميزانية والالتزام (Procore / Autodesk Build / Precoro)

| المؤشر | التعريف عندنا |
|---|---|
| التقديري الأصلي | العرض المالي اللي بتدخله المالية — **بيتقفل** أول ما يتعتمد أول مستند |
| تعديلات الميزانية | زيادة / تخفيض بسبب مكتوب، **مش بتتمسح** (زي Procore Budget Modifications) |
| الميزانية المعدلة | الأصلي + التعديلات |
| الملتزم به | المستندات المعتمدة (الفاتورة النهائية بتحل محل عرض السعر — زي Precoro) |
| المفوتر | الفواتير الضريبية المستلمة |
| المسدد | الدفعات (قبل الضريبة بالتناسب) |
| تحت المراجعة | المرفوع ولسه ما اتعتمدش |
| المتوقع عند الإنجاز | الأكبر من (الملتزم + تحت المراجعة) أو المفوتر |
| الانحراف المتوقع | الميزانية المعدلة − المتوقع |

## 3. أنماط الاعتماد

- **Precoro:** المعتمِد بيشوف المتبقي من الميزانية **جوه شاشة الاعتماد** ← طبقناه: صندوق "ميزانية البند" في نافذة الاعتماد.
- **Precoro Overbudget Approval:** خطوة إضافية لو الطلب متجاوز الميزانية ← طبقناه: **الاعتماد رغم التجاوز لازم سبب مكتوب، والإدارة بيوصلها إشعار**.
- **Procore "Approved as Noted":** اعتماد بملاحظة ← موجود.
- **Coupa:** صندوق مهام لكل معتمِد + تذكير بالمتأخر ← طبقناه: **لوحة التحكم بقت صندوق مهام** مرتب بالأقدم والأكثر تأخيراً، وزر إجراء مباشر لكل مهمة.

## 4. السداد

- **دفعات جزئية متعددة** (Precoro: "Partly paid") ← موجود.
- **المحتجزات / ضمان حسن التنفيذ** (Procore Retainage) ← طبقناه: نسبة محتجز لكل مستند، بتتخصم من السداد لحد ما المالية **تفرج عنها**.
- **أعمار المستحقات** (Oracle / Zoho AP Aging) ← طبقناه: 1–30 / 31–60 / 61–90 / +90 يوم.
- **المستحق خلال 7 أيام** (Oracle Payables infolet) ← في لوحة التحكم.
- **حماية من السداد الزائد**: trigger في قاعدة البيانات بيرفض أي دفعة تتعدى قيمة المستند أو قبل اعتماده.

## 5. المتطلبات السعودية (هيئة الزكاة والضريبة والجمارك — ZATCA)

| القاعدة | التطبيق |
|---|---|
| الرقم الضريبي 15 رقم يبدأ وينتهي بـ 3 | **تحقق تلقائي** + رابط مباشر لخدمة التحقق من التسجيل على ZATCA |
| الآيبان السعودي SA + 22 رقم (24 خانة) | **تحقق بصيغة mod-97** + زر نسخ وقت السداد |
| رمز QR في الفاتورة الإلكترونية (TLV Base64: البائع، الرقم الضريبي، التاريخ، الإجمالي، الضريبة) | **قراءة تلقائية من صورة الفاتورة** وتعبئة البيانات، وتنبيه لو الرقم الضريبي مختلف عن المسجل للمورد |
| عرض السعر مش فاتورة ضريبية ← ضريبة المدخلات ما تتستردش قبل الفاتورة | **"ضريبة معلّقة"** منفصلة عن **"قابلة للاسترداد"** في كل مكان |
| **الدفعة المقدمة نقطة استحقاق ضريبي** ← المورد ملزم بفاتورة عن كل دفعة | **أكتر من فاتورة ضريبية لنفس عرض السعر**: "عن دفعة" + "نهائية" بتخصم الدفعات السابقة (معيار ZATCA XML v1.2) |
| الضريبة على كامل القيمة شاملة المحتجز (دليل قطاع المقاولات) | المحتجز بيتحسب من الإجمالي شامل الضريبة |
| حفظ السجلات 6 سنوات على الأقل | **المستند اللي عليه دفعات ممنوع حذفه** + **سجل تدقيق غير قابل للتعديل** |
| التواريخ ميلادي (ISO) | ميلادي في كل النظام، ومنع التواريخ المستقبلية |

## 6. سجل التدقيق (Procore Change History / SAP Ariba)

- **جدول audit_log** بيكتبه trigger في قاعدة البيانات لكل إنشاء / تعديل / حذف، بالقيم **قبل وبعد**.
- محدش يقدر يعدله أو يمسحه من الموقع (RLS).
- بيظهر جوه أي مستند: "سجل التغييرات التفصيلي".

## 7. مؤشرات الأداء (Coupa Benchmark / Oracle)

- متوسط الأيام: من الرفع للاعتماد، من الاعتماد للسداد، من السداد لاستلام الفاتورة الضريبية.
- الإنفاق حسب البند والمورد، وكشف حساب لكل مورد.

## 8. اتأجل (مقترح لمراحل قادمة)

| الميزة | ليه اتأجلت |
|---|---|
| تذكيرات بالإيميل وملخص يومي | محتاجة Supabase Edge Function + خدمة إيميل (القرار الحالي: إشعارات داخل الموقع) |
| جدول دفعات (50% مقدم / 40% تسليم / 10% محتجز) | النسبة المطلوبة + طلب دفعة إضافية + المحتجز بيغطوا الحالات الحالية |
| موافقة الإدارة فوق حد مبلغ معين | ممكن نضيفها كإعداد لو الشركة احتاجت |
| قراءة ملف XML / PDF‑A3 للفاتورة الإلكترونية | QR بيغطي البيانات الأساسية حالياً |
| لقطات شهرية للميزانية (Snapshots) | محتاجة مهمة مجدولة (pg_cron) |

---

### المصادر
- Procore Budget: https://v2.support.procore.com/en-gb/product-manuals/budget-project/tutorials/read-a-budget
- Procore Budget Modifications: https://v2.support.procore.com/product-manuals/budget-project/tutorials/create-a-budget-modification
- Procore Retainage: https://v2.support.procore.com/product-manuals/commitments-project/tutorials/enable-retainage-on-a-purchase-order-or-subcontract
- Precoro Prepayments: https://help.precoro.com/how-to-add-prepayments-to-the-purchase-orders
- Precoro Budget: https://help.precoro.com/calculating-and-tracking-the-available-budget-sum
- Coupa Approvals: https://get.coupa.com/rs/950-OLU-185/images/Approvals.pdf
- Coupa Invoice Tolerances: https://get.coupa.com/rs/950-OLU-185/images/Invoicing_Tolerances.pdf
- Oracle Payables Holds / Duplicates: https://docs.oracle.com/en/cloud/saas/financials/26a/fappp/how-can-i-find-duplicate-invoices-without-considering-the.html
- Odoo Payment Terms: https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/payment_terms.html
- ZATCA VAT Verification: https://zatca.gov.sa/en/eServices/Pages/eServices-007.aspx
- ZATCA QR structure (forum): https://zatca1.discourse.group/t/structure-of-the-qr-code-for-electronic-tax-invoices/483
- ZATCA XML Implementation Standard (prepayment invoices): https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf
- ZATCA Contracting Sector Guideline: https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-For-the-Contracting-Sector-under-VAT-Provision.pdf
- Time of supply (advance payments): https://www.cleartax.com/sa/time-of-supply-under-vat-saudi-arabia
- Input VAT recovery: https://www.dariba.co/input-vat-recovery-entitlement/
- Record keeping: https://www.dariba.co/record-keeping-obligations/
- Saudi IBAN: https://wise.com/ie/iban/saudi-arabia

> بعض أرقام المواد في اللوائح جاية من مصادر ثانوية — يُفضل مراجعتها مع المستشار الضريبي للشركة.
