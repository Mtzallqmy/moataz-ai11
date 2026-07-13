import { Link } from 'react-router-dom'
import { 
  ArrowLeft, MessageCircle, Bot, Zap, Shield, 
  Github, Send, Plug, CheckCircle 
} from 'lucide-react'
import { motion } from 'framer-motion'

const features = [
  {
    icon: MessageCircle,
    title: 'محادثات ذكية متدفقة',
    desc: 'تفاعل طبيعي مع أقوى نماذج الذكاء الاصطناعي مع بث مباشر للردود ودعم Markdown والكود.'
  },
  {
    icon: Bot,
    title: 'وضع الوكيل المتقدم',
    desc: 'تنفيذ مهام متعددة الخطوات تلقائياً مع تخطيط ذكي واستخدام الأدوات ومراجعة النتائج.'
  },
  {
    icon: Plug,
    title: 'تكاملات قوية',
    desc: 'ربط GitHub لإدارة المستودعات، Telegram للإشعارات، وخوادم MCP للأدوات المخصصة.'
  },
  {
    icon: Shield,
    title: 'أمان وخصوصية',
    desc: 'مفاتيح API مشفرة، جلسات آمنة، وتحكم كامل في البيانات. لا نشارك بياناتك أبداً.'
  }
]

const providers = ['Google Gemini', 'OpenAI', 'Anthropic', 'NVIDIA NIM', 'Groq', 'DeepSeek', 'Mistral', 'Together AI']

const stats = [
  { number: '12+', label: 'مزود ذكاء اصطناعي' },
  { number: '99.9%', label: 'وقت التشغيل' },
  { number: '4.8s', label: 'متوسط زمن الاستجابة' },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-dark-950 text-white overflow-hidden">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-dark-950/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center">
              <span className="font-bold text-xl tracking-[-2px]">م</span>
            </div>
            <div>
              <div className="font-semibold text-xl tracking-tight">معتز العلقمي</div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <Link to="/privacy" className="text-white/70 hover:text-white transition-colors hidden sm:block">الخصوصية</Link>
            <Link to="/terms" className="text-white/70 hover:text-white transition-colors hidden sm:block">الشروط</Link>
            <Link 
              to="/login" 
              className="px-5 py-2 rounded-full border border-white/20 hover:bg-white/5 transition-all text-sm font-medium"
            >
              تسجيل الدخول
            </Link>
            <Link 
              to="/register" 
              className="btn btn-primary px-6 py-2 text-sm"
            >
              ابدأ مجاناً
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="pt-20 pb-16 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-white/5 border border-white/10 text-xs tracking-[2px] mb-6">
            منصة الذكاء الاصطناعي العربية الاحترافية
          </div>
          
          <h1 className="text-6xl md:text-7xl font-semibold tracking-tighter leading-[1.05] mb-6">
            الذكاء الاصطناعي.<br />ببساطة أقوى.
          </h1>
          
          <p className="max-w-2xl mx-auto text-xl text-white/70 mb-10">
            منصة ويب متكاملة تتيح لك إجراء محادثات متقدمة، تشغيل وكلاء ذكيين، وربط أدواتك المفضلة بأمان تام.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link 
              to="/register" 
              className="btn btn-primary px-10 py-4 text-base group"
            >
              ابدأ الآن مجاناً
              <ArrowLeft className="group-hover:-translate-x-0.5 transition" size={18} />
            </Link>
            <Link 
              to="/login" 
              className="btn btn-secondary px-8 py-4 text-base border-white/20"
            >
              تسجيل الدخول
            </Link>
          </div>
          
          <div className="mt-8 text-xs text-white/50">لا حاجة لبطاقة ائتمان • ابدأ في أقل من 30 ثانية</div>
        </div>
      </div>

      {/* Stats */}
      <div className="border-y border-white/10 py-8">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          {stats.map((stat, i) => (
            <div key={i}>
              <div className="text-4xl font-semibold tracking-tighter text-primary-400">{stat.number}</div>
              <div className="text-white/60 mt-1 text-sm">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <div className="text-primary-400 text-sm tracking-[3px] mb-3">كل ما تحتاجه في مكان واحد</div>
          <h2 className="text-4xl font-semibold tracking-tight">مميزات مصممة للمحترفين</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <motion.div 
                key={index}
                whileHover={{ y: -4 }}
                className="card p-8 border-white/10 bg-dark-900/50"
              >
                <div className="w-12 h-12 rounded-2xl bg-primary-950 flex items-center justify-center mb-6">
                  <Icon className="text-primary-400" size={24} />
                </div>
                <h3 className="text-2xl font-semibold tracking-tight mb-3">{feature.title}</h3>
                <p className="text-white/70 leading-relaxed">{feature.desc}</p>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Providers */}
      <div className="bg-dark-900 border-y border-white/10 py-16">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <div className="text-sm text-primary-400 tracking-widest mb-4">مدعوم من أفضل النماذج</div>
          <h3 className="text-3xl font-semibold tracking-tight mb-10">اختر من بين أكثر من 12 مزوداً ونموذجاً</h3>
          
          <div className="flex flex-wrap justify-center gap-3">
            {providers.map((p, i) => (
              <div key={i} className="px-5 py-2 bg-white/5 border border-white/10 rounded-full text-sm font-medium">
                {p}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-semibold tracking-tight">كيف يعمل؟</h2>
          <p className="text-white/60 mt-3">ثلاث خطوات بسيطة للبدء</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            { step: '01', title: 'أنشئ حساباً', desc: 'سجل مجاناً في ثوانٍ معدودة.' },
            { step: '02', title: 'أضف مزودك', desc: 'أدخل مفتاح API الخاص بك (Gemini, OpenAI, NVIDIA...)' },
            { step: '03', title: 'ابدأ الإنشاء', desc: 'أنشئ محادثات أو شغّل وكيلاً لتنفيذ مهامك.' },
          ].map((item, i) => (
            <div key={i} className="relative pl-8 border-l border-white/10">
              <div className="text-6xl font-bold text-white/10 tracking-[-4px] absolute -top-3 right-0">{item.step}</div>
              <div className="font-semibold text-xl mb-2">{item.title}</div>
              <p className="text-white/70">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="border-t border-white/10 py-16 bg-dark-900">
        <div className="max-w-xl mx-auto text-center px-6">
          <h2 className="text-4xl font-semibold tracking-tight mb-4">جاهز للارتقاء بإنتاجيتك؟</h2>
          <p className="text-white/70 mb-8">انضم إلى مئات المطورين والمهندسين الذين يستخدمون معتز العلقمي يومياً.</p>
          <Link to="/register" className="btn btn-primary px-10 py-4 text-base inline-flex">
            ابدأ مجاناً الآن
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 py-10 text-center text-xs text-white/50">
        © {new Date().getFullYear()} معتز العلقمي. جميع الحقوق محفوظة. • 
        <Link to="/privacy" className="hover:text-white/80 mx-1.5">سياسة الخصوصية</Link> • 
        <Link to="/terms" className="hover:text-white/80 mx-1.5">شروط الاستخدام</Link>
      </footer>
    </div>
  )
}
