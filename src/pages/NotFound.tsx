import { Link } from 'react-router-dom'
import { Home } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-950 text-center p-6">
      <div>
        <div className="text-[120px] font-bold tracking-[-8px] text-dark-800">404</div>
        <h1 className="text-3xl font-semibold tracking-tight -mt-6">الصفحة غير موجودة</h1>
        <p className="text-dark-400 mt-3 max-w-xs mx-auto">ربما تم نقل الصفحة أو حذفها.</p>
        
        <Link to="/dashboard" className="btn btn-primary mt-8 inline-flex items-center gap-2">
          <Home size={18} /> العودة إلى لوحة التحكم
        </Link>
      </div>
    </div>
  )
}
