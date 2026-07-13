import { Link } from 'react-router-dom'

export default function Terms() {
  return (
    <div className="max-w-3xl mx-auto p-8 text-dark-200">
      <Link to="/" className="text-primary-400 text-sm">← العودة للرئيسية</Link>
      <h1 className="text-4xl font-semibold tracking-tight mt-6 mb-8">شروط الاستخدام</h1>
      
      <div className="prose prose-invert max-w-none text-sm leading-relaxed">
        <p>باستخدامك لمنصة معتز العلقمي، فإنك توافق على هذه الشروط.</p>
        
        <h3 className="mt-8">الاستخدام المسؤول</h3>
        <p>لا تستخدم المنصة لأغراض غير قانونية أو ضارة. نحن نحتفظ بالحق في تعليق الحسابات التي تنتهك هذه الشروط.</p>

        <h3 className="mt-8">المسؤولية</h3>
        <p>المنصة مقدمة "كما هي". لا نضمن دقة الردود الناتجة عن نماذج الذكاء الاصطناعي.</p>

        <p className="mt-10 text-xs text-dark-500">© معتز العلقمي 2026</p>
      </div>
    </div>
  )
}
