import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { toast } from 'sonner'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as any)?.from?.pathname || '/dashboard'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      toast.error('يرجى إدخال البريد وكلمة المرور')
      return
    }
    
    setIsLoading(true)
    const success = await login(email, password)
    setIsLoading(false)
    
    if (success) {
      navigate(from, { replace: true })
    }
  }

  // Demo hint
  const fillDemo = () => {
    setEmail('demo@moataz.dev')
    setPassword('demo1234')
    toast.info('تم ملء بيانات التجربة. اضغط تسجيل الدخول.')
  }

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-dark-400 hover:text-white mb-8 group">
          <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition" /> العودة للصفحة الرئيسية
        </Link>

        <div className="card p-8 border-dark-700">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center">
              <span className="text-white text-3xl font-bold tracking-[-2px]">م</span>
            </div>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-center mb-2">مرحباً بعودتك</h1>
          <p className="text-center text-dark-400 mb-8">سجل الدخول للوصول إلى منصتك</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-2 text-dark-300">البريد الإلكتروني</label>
              <input 
                type="email" 
                className="input" 
                placeholder="you@example.com" 
                value={email} 
                onChange={e => setEmail(e.target.value)}
                required 
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-dark-300">كلمة المرور</label>
              <div className="relative">
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  className="input pr-12" 
                  placeholder="••••••••" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)}
                  required 
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={isLoading}
              className="btn btn-primary w-full py-3.5 text-base mt-2"
            >
              {isLoading ? 'جارٍ تسجيل الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm">
            ليس لديك حساب؟{' '}
            <Link to="/register" className="text-primary-400 hover:underline font-medium">أنشئ حساباً جديداً</Link>
          </div>

          <div className="mt-8 pt-6 border-t border-dark-700 text-center">
            <button 
              onClick={fillDemo}
              className="text-xs text-dark-500 hover:text-primary-400 underline"
            >
              استخدم حساب التجربة (demo@moataz.dev)
            </button>
          </div>
        </div>

        <p className="text-center text-[10px] text-dark-500 mt-6">منصة معتز العلقمي — الإصدار التجريبي</p>
      </div>
    </div>
  )
}
