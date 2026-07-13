import { Link } from 'react-router-dom'

export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto p-8 text-dark-200">
      <Link to="/" className="text-primary-400 text-sm">← العودة للرئيسية</Link>
      <h1 className="text-4xl font-semibold tracking-tight mt-6 mb-8">سياسة الخصوصية</h1>
      
      <div className="prose prose-invert max-w-none text-sm leading-relaxed">
        <p>نحن في منصة معتز العلقمي نلتزم بحماية خصوصيتك. هذه النسخة التجريبية تخزن البيانات محلياً في متصفحك فقط.</p>
        
        <h3 className="mt-8">البيانات التي نجمعها</h3>
        <ul>
          <li>معلومات الحساب (الاسم، البريد) للمصادقة.</li>
          <li>المحادثات والرسائل (مخزنة محلياً).</li>
          <li>مفاتيح API (مخزنة محلياً في هذه النسخة، ومشفرة في الإنتاج).</li>
        </ul>

        <h3 className="mt-8">كيف نستخدم البيانات</h3>
        <p>نستخدم بياناتك فقط لتقديم الخدمة. لا نبيع أو نشارك بياناتك مع أطراف ثالثة.</p>

        <p className="mt-10 text-xs text-dark-500">آخر تحديث: يوليو 2026</p>
      </div>
    </div>
  )
}
