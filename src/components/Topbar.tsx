import { Menu, Moon, Sun, Bell } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { User } from '../types'

interface TopbarProps {
  onToggleSidebar: () => void
  sidebarOpen: boolean
  user: User | null
}

export default function Topbar({ onToggleSidebar, sidebarOpen, user }: TopbarProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="h-16 border-b border-dark-200 dark:border-dark-700 bg-white/80 dark:bg-dark-900/80 backdrop-blur-lg flex items-center justify-between px-4 md:px-6 z-30 flex-shrink-0">
      <div className="flex items-center gap-4">
        <button 
          onClick={onToggleSidebar}
          className="p-2.5 rounded-xl hover:bg-dark-100 dark:hover:bg-dark-800 text-dark-500 md:hidden"
        >
          <Menu size={20} />
        </button>
        
        <div className="hidden md:block">
          <div className="text-sm text-dark-500">مرحباً، <span className="font-medium text-dark-700 dark:text-dark-200">{user?.name?.split(' ')[0]}</span></div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Status indicator */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          النظام يعمل بكفاءة
        </div>

        <button 
          onClick={toggleTheme}
          className="p-2.5 rounded-xl hover:bg-dark-100 dark:hover:bg-dark-800 text-dark-500 transition-colors"
          aria-label="تبديل الوضع"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button className="p-2.5 rounded-xl hover:bg-dark-100 dark:hover:bg-dark-800 text-dark-500 relative">
          <Bell size={18} />
          <div className="absolute top-2 right-2 w-2 h-2 bg-primary-500 rounded-full" />
        </button>

        {/* Mobile user avatar */}
        <div className="md:hidden">
          <img 
            src={user?.avatar} 
            alt="" 
            className="w-8 h-8 rounded-full ring-2 ring-dark-200 dark:ring-dark-700"
          />
        </div>
      </div>
    </header>
  )
}
