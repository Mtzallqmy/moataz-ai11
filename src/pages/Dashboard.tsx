import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle, Bot, Plug, TrendingUp, Plus, ArrowLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Chat, Provider } from '../types'
import { formatDate } from '../lib/utils'

export default function Dashboard() {
  const { user } = useAuth()
  const [chats, setChats] = useState<Chat[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [stats, setStats] = useState({ chats: 0, providers: 0, integrations: 2 })

  useEffect(() => {
    // Load from localStorage
    const savedChats = localStorage.getItem('moataz_chats')
    if (savedChats) setChats(JSON.parse(savedChats).slice(0, 5))

    const savedProviders = localStorage.getItem('moataz_providers')
    if (savedProviders) {
      const parsed = JSON.parse(savedProviders)
      setProviders(parsed)
      setStats(s => ({ ...s, providers: parsed.length, chats: JSON.parse(savedChats || '[]').length }))
    }
  }, [])

  const quickActions = [
    { to: '/chat', icon: MessageCircle, label: 'محادثة جديدة', desc: 'ابدأ دردشة مع نموذج ذكي' },
    { to: '/providers', icon: Bot, label: 'إضافة مزود', desc: 'ربط Gemini أو OpenAI أو NVIDIA' },
    { to: '/integrations', icon: Plug, label: 'إدارة التكاملات', desc: 'GitHub • Telegram • MCP' },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Welcome Header */}
      <div className="mb-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">مرحباً، {user?.name?.split(' ')[0]}</h1>
            <p className="text-dark-400 mt-1">إليك نظرة عامة على نشاطك اليوم</p>
          </div>
          <Link to="/chat" className="btn btn-primary hidden md:flex items-center gap-2">
            <Plus size={16} /> محادثة جديدة
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <div className="card p-6">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-dark-400 text-sm">المحادثات</div>
              <div className="text-4xl font-semibold tracking-tight mt-1">{stats.chats}</div>
            </div>
            <div className="p-3 bg-primary-950 rounded-2xl"><MessageCircle className="text-primary-400" /></div>
          </div>
          <div className="text-emerald-400 text-xs mt-4 flex items-center gap-1">
            <TrendingUp size={14} /> +{Math.floor(Math.random()*4)+1} هذا الأسبوع
          </div>
        </div>

        <div className="card p-6">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-dark-400 text-sm">المزودون النشطون</div>
              <div className="text-4xl font-semibold tracking-tight mt-1">{stats.providers}</div>
            </div>
            <div className="p-3 bg-emerald-950 rounded-2xl"><Bot className="text-emerald-400" /></div>
          </div>
          <div className="text-xs mt-4 text-dark-400">من أصل 12 مزود مدعوم</div>
        </div>

        <div className="card p-6">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-dark-400 text-sm">التكاملات</div>
              <div className="text-4xl font-semibold tracking-tight mt-1">{stats.integrations}</div>
            </div>
            <div className="p-3 bg-amber-950 rounded-2xl"><Plug className="text-amber-400" /></div>
          </div>
          <div className="text-xs mt-4 text-dark-400">GitHub • Telegram</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Recent Chats */}
        <div className="lg:col-span-7 card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-lg">آخر المحادثات</h2>
            <Link to="/chat" className="text-sm text-primary-400 hover:underline flex items-center gap-1">عرض الكل <ArrowLeft size={14} /></Link>
          </div>

          {chats.length > 0 ? (
            <div className="space-y-2">
              {chats.map(chat => (
                <Link key={chat.id} to={`/chat/${chat.id}`} className="flex items-center justify-between p-4 rounded-2xl hover:bg-dark-800/60 border border-transparent hover:border-dark-700 transition-all group">
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-xl bg-dark-800 flex items-center justify-center flex-shrink-0">
                      <MessageCircle size={16} className="text-primary-400" />
                    </div>
                    <div>
                      <div className="font-medium group-hover:text-primary-400 transition-colors">{chat.title}</div>
                      <div className="text-xs text-dark-500">{chat.model} • {formatDate(chat.updatedAt)}</div>
                    </div>
                  </div>
                  <div className="text-xs px-3 py-1 rounded-full bg-dark-800 text-dark-400">{chat.messageCount} رسالة</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-dark-400">
              <MessageCircle className="mx-auto mb-3 opacity-40" size={32} />
              <p>لا توجد محادثات بعد</p>
              <Link to="/chat" className="text-primary-400 text-sm mt-2 inline-block">ابدأ محادثتك الأولى →</Link>
            </div>
          )}
        </div>

        {/* Quick Actions + Active Providers */}
        <div className="lg:col-span-5 space-y-6">
          <div className="card p-6">
            <h2 className="font-semibold text-lg mb-4">إجراءات سريعة</h2>
            <div className="space-y-3">
              {quickActions.map((action, i) => {
                const Icon = action.icon
                return (
                  <Link key={i} to={action.to} className="flex items-center gap-4 p-4 rounded-2xl border border-dark-700 hover:border-primary-800 hover:bg-dark-800/40 transition-all group">
                    <div className="p-3 bg-dark-800 rounded-xl group-hover:bg-primary-950 transition-colors">
                      <Icon className="text-primary-400" size={20} />
                    </div>
                    <div>
                      <div className="font-medium">{action.label}</div>
                      <div className="text-xs text-dark-400">{action.desc}</div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-semibold text-lg mb-4">المزودون المتصلون</h2>
            {providers.length > 0 ? (
              <div className="space-y-3">
                {providers.slice(0, 3).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <div className="font-medium">{p.name}</div>
                    <div className={`status-dot ${p.status === 'connected' ? 'status-connected' : 'status-disconnected'}`} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-dark-400 text-sm mb-3">لم تقم بإضافة أي مزود بعد</p>
                <Link to="/providers" className="text-primary-400 text-sm">أضف مزود الآن →</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
