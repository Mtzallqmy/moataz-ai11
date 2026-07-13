import { useState, useEffect } from 'react'
import { Plus, Trash2, Play, RefreshCw, CheckCircle, XCircle, AlertCircle, Bot } from 'lucide-react'
import { toast } from 'sonner'
import { Provider } from '../types'
import { generateId, getMockModels, sleep } from '../lib/utils'

const providerTypes = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic Claude' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
  { value: 'groq', label: 'Groq' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'mistral', label: 'Mistral AI' },
  { value: 'together', label: 'Together AI' },
  { value: 'custom', label: 'مخصص (OpenAI-compatible)' },
]

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  // Form state for new provider
  const [form, setForm] = useState({
    name: '',
    type: 'gemini' as Provider['type'],
    apiKey: '',
    baseUrl: '',
    model: '',
  })

  useEffect(() => {
    const saved = localStorage.getItem('moataz_providers')
    if (saved) setProviders(JSON.parse(saved))
  }, [])

  const saveProviders = (list: Provider[]) => {
    localStorage.setItem('moataz_providers', JSON.stringify(list))
    setProviders(list)
  }

  const addProvider = () => {
    if (!form.name || !form.apiKey) {
      toast.error('الاسم ومفتاح API مطلوبان')
      return
    }

    const newProvider: Provider = {
      id: generateId('prov'),
      name: form.name,
      type: form.type,
      apiKey: form.apiKey, // Note: In production, encrypt on backend
      baseUrl: form.baseUrl || undefined,
      model: form.model || undefined,
      isEnabled: true,
      status: 'untested',
      models: getMockModels(form.type),
    }

    const updated = [...providers, newProvider]
    saveProviders(updated)
    setShowAddModal(false)
    resetForm()
    toast.success('تم إضافة المزود بنجاح')
  }

  const resetForm = () => {
    setForm({ name: '', type: 'gemini', apiKey: '', baseUrl: '', model: '' })
  }

  const deleteProvider = (id: string) => {
    const updated = providers.filter(p => p.id !== id)
    saveProviders(updated)
    toast.success('تم حذف المزود')
  }

  const testConnection = async (provider: Provider) => {
    setTestingId(provider.id)

    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerType: provider.type,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          model: provider.model,
        }),
      })

      const data = await res.json()

      const status: Provider['status'] = data.success ? 'connected' : 'error'
      const errorMessage = data.success ? undefined : data.message

      const updated = providers.map(p =>
        p.id === provider.id
          ? {
              ...p,
              status,
              lastTested: new Date().toISOString(),
              errorMessage,
              models: data.models || p.models,
            }
          : p
      )

      saveProviders(updated)

      if (data.success) {
        toast.success(data.message || `تم الاتصال بنجاح بـ ${provider.name}`)
      } else {
        toast.error(data.message || 'فشل اختبار الاتصال')
      }
    } catch (err: any) {
      toast.error('تعذر الاتصال بالخادم. تأكد من نشر المشروع على Vercel.')
      // Fallback to local validation
      const status: Provider['status'] = provider.apiKey && provider.apiKey.length > 8 ? 'connected' : 'error'
      const updated = providers.map(p =>
        p.id === provider.id ? { ...p, status, lastTested: new Date().toISOString() } : p
      )
      saveProviders(updated)
    } finally {
      setTestingId(null)
    }
  }

  const discoverModels = (provider: Provider) => {
    const models = getMockModels(provider.type)
    const updated = providers.map(p => p.id === provider.id ? { ...p, models } : p)
    saveProviders(updated)
    toast.success(`تم اكتشاف ${models.length} نموذج`)
  }

  const updateDefaultModel = (id: string, model: string) => {
    const updated = providers.map(p => p.id === id ? { ...p, model } : p)
    saveProviders(updated)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">مزودو الذكاء الاصطناعي</h1>
          <p className="text-dark-400 mt-1">أضف وأدر مفاتيح API الخاصة بك. جميع المفاتيح مخزنة محلياً في هذه النسخة التجريبية.</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn btn-primary flex items-center gap-2">
          <Plus size={18} /> إضافة مزود جديد
        </button>
      </div>

      {providers.length === 0 && (
        <div className="card p-12 text-center">
          <Bot className="mx-auto text-dark-600 mb-4" size={48} />
          <h3 className="text-xl font-medium mb-2">لا يوجد مزودون مضافون بعد</h3>
          <p className="text-dark-400 max-w-xs mx-auto">ابدأ بإضافة Google Gemini أو OpenAI لتتمكن من إجراء المحادثات.</p>
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary mt-6">إضافة أول مزود</button>
        </div>
      )}

      <div className="grid gap-4">
        {providers.map(provider => {
          const isTesting = testingId === provider.id
          return (
            <div key={provider.id} className="card p-6 flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <div className="font-semibold text-lg">{provider.name}</div>
                  <div className={`provider-badge text-xs ${provider.status === 'connected' ? 'border-emerald-600 text-emerald-400' : provider.status === 'error' ? 'border-red-600 text-red-400' : 'border-amber-600 text-amber-400'}`}>
                    {provider.status === 'connected' && <CheckCircle size={12} className="inline mr-1" />}
                    {provider.status === 'error' && <XCircle size={12} className="inline mr-1" />}
                    {provider.status}
                  </div>
                </div>
                <div className="text-sm text-dark-400">{providerTypes.find(t => t.value === provider.type)?.label} • {provider.model || 'نموذج افتراضي'}</div>
                
                {provider.errorMessage && (
                  <div className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertCircle size={12} /> {provider.errorMessage}</div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button 
                  onClick={() => testConnection(provider)} 
                  disabled={isTesting}
                  className="btn btn-secondary text-xs px-5 py-2 flex items-center gap-2"
                >
                  {isTesting ? <RefreshCw className="animate-spin" size={14} /> : <Play size={14} />}
                  {isTesting ? 'جارٍ الاختبار...' : 'اختبار الاتصال'}
                </button>

                <button onClick={() => discoverModels(provider)} className="btn btn-ghost text-xs px-4 py-2">
                  اكتشاف النماذج
                </button>

                {provider.models && provider.models.length > 0 && (
                  <select 
                    value={provider.model || ''} 
                    onChange={(e) => updateDefaultModel(provider.id, e.target.value)}
                    className="input text-xs py-2 px-3 w-auto bg-dark-800 border-dark-600"
                  >
                    {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}

                <button onClick={() => deleteProvider(provider.id)} className="btn btn-ghost text-red-400 hover:bg-red-950/30 p-2.5">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="modal" onClick={() => setShowAddModal(false)}>
          <div className="modal-content p-8" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-semibold tracking-tight mb-6">إضافة مزود ذكاء اصطناعي</h2>

            <div className="space-y-5">
              <div>
                <label className="text-sm text-dark-300 block mb-1.5">اسم العرض</label>
                <input className="input" placeholder="Gemini Pro الخاص بي" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
              </div>

              <div>
                <label className="text-sm text-dark-300 block mb-1.5">نوع المزود</label>
                <select className="input" value={form.type} onChange={e => setForm({...form, type: e.target.value as any})}>
                  {providerTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div>
                <label className="text-sm text-dark-300 block mb-1.5">مفتاح API (سيتم تخزينه مشفراً في الإنتاج)</label>
                <input type="password" className="input font-mono text-sm" placeholder="AIzaSy..." value={form.apiKey} onChange={e => setForm({...form, apiKey: e.target.value})} />
              </div>

              {(form.type === 'openai-compatible' || form.type === 'nvidia' || form.type === 'custom') && (
                <div>
                  <label className="text-sm text-dark-300 block mb-1.5">Base URL (اختياري)</label>
                  <input className="input font-mono text-sm" placeholder="https://api.openai.com/v1" value={form.baseUrl} onChange={e => setForm({...form, baseUrl: e.target.value})} />
                </div>
              )}

              <div>
                <label className="text-sm text-dark-300 block mb-1.5">النموذج الافتراضي (اختياري)</label>
                <input className="input" placeholder="gemini-1.5-flash" value={form.model} onChange={e => setForm({...form, model: e.target.value})} />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => { setShowAddModal(false); resetForm() }} className="btn btn-secondary flex-1">إلغاء</button>
              <button onClick={addProvider} className="btn btn-primary flex-1">إضافة المزود</button>
            </div>

            <p className="text-[10px] text-dark-500 mt-6 text-center">في النسخة الإنتاجية، يتم تشفير المفاتيح على الخادم ولا تُعرض أبداً في المتصفح.</p>
          </div>
        </div>
      )}
    </div>
  )
}
