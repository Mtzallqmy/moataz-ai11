import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { toast } from 'sonner'

export default function Settings() {
  const { user, updateUser, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()

  const handleUpdateName = () => {
    const newName = prompt('الاسم الجديد:', user?.name)
    if (newName && user) {
      updateUser({ name: newName })
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight mb-8">الإعدادات</h1>

      <div className="space-y-8">
        <div className="card p-7">
          <h3 className="font-semibold mb-4">الملف الشخصي</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b border-dark-700">
              <div>
                <div className="text-sm text-dark-400">الاسم</div>
                <div className="font-medium">{user?.name}</div>
              </div>
              <button onClick={handleUpdateName} className="text-primary-400 text-sm">تعديل</button>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-dark-700">
              <div>
                <div className="text-sm text-dark-400">البريد الإلكتروني</div>
                <div className="font-medium">{user?.email}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-7">
          <h3 className="font-semibold mb-4">المظهر</h3>
          <div className="flex items-center justify-between">
            <div>الوضع الحالي: <span className="font-mono text-xs px-2 py-0.5 bg-dark-800 rounded">{theme}</span></div>
            <button onClick={toggleTheme} className="btn btn-secondary">تبديل الوضع (Dark/Light)</button>
          </div>
        </div>

        <div className="card p-7 border-red-900/30">
          <h3 className="font-semibold mb-2 text-red-400">منطقة الخطر</h3>
          <p className="text-sm text-dark-400 mb-4">تسجيل الخروج سيحذف جلسة المتصفح الحالية.</p>
          <button onClick={logout} className="btn btn-danger">تسجيل الخروج من جميع الأجهزة</button>
        </div>
      </div>
    </div>
  )
}
