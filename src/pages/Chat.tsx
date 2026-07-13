import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
  Send, Square, Plus, Search, Trash2, Bot, User, 
  Settings2, ChevronDown 
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { useAuth } from '../contexts/AuthContext'
import { Chat as ChatType, Message, Provider } from '../types'
import { generateId, generateMockResponse, sendRealChatRequest, sendRealStreamingChat, sleep, formatDate } from '../lib/utils'

export default function Chat() {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [chats, setChats] = useState<ChatType[]>([])
  const [currentChat, setCurrentChat] = useState<ChatType | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [mode, setMode] = useState<'chat' | 'agent'>('chat')
  const [showAgentPanel, setShowAgentPanel] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Load data
  useEffect(() => {
    const savedChats = localStorage.getItem('moataz_chats')
    const parsedChats: ChatType[] = savedChats ? JSON.parse(savedChats) : []
    setChats(parsedChats)

    const savedProviders = localStorage.getItem('moataz_providers')
    const parsedProviders: Provider[] = savedProviders ? JSON.parse(savedProviders) : []
    setProviders(parsedProviders)

    if (parsedProviders.length > 0 && !selectedProvider) {
      const defaultProv = parsedProviders.find(p => p.isEnabled) || parsedProviders[0]
      setSelectedProvider(defaultProv)
      setSelectedModel(defaultProv.model || (defaultProv.models?.[0] ?? 'gemini-1.5-flash'))
    }
  }, [])

  // Load specific chat or create new
  useEffect(() => {
    if (chatId) {
      const found = chats.find(c => c.id === chatId)
      if (found) {
        setCurrentChat(found)
        loadMessages(found.id)
        setMode(found.mode)
      } else {
        navigate('/chat')
      }
    } else if (chats.length === 0) {
      createNewChat()
    }
  }, [chatId, chats])

  const loadMessages = (id: string) => {
    const saved = localStorage.getItem(`moataz_messages_${id}`)
    setMessages(saved ? JSON.parse(saved) : [])
  }

  const saveMessages = (chatId: string, msgs: Message[]) => {
    localStorage.setItem(`moataz_messages_${chatId}`, JSON.stringify(msgs))
  }

  const saveChats = (updatedChats: ChatType[]) => {
    localStorage.setItem('moataz_chats', JSON.stringify(updatedChats))
    setChats(updatedChats)
  }

  const createNewChat = () => {
    const newChat: ChatType = {
      id: generateId('chat'),
      title: 'محادثة جديدة',
      providerId: selectedProvider?.id || '',
      model: selectedModel,
      mode: mode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    }
    
    const updated = [newChat, ...chats]
    saveChats(updated)
    setCurrentChat(newChat)
    setMessages([])
    navigate(`/chat/${newChat.id}`, { replace: true })
  }

  const deleteChat = (id: string) => {
    const updated = chats.filter(c => c.id !== id)
    saveChats(updated)
    localStorage.removeItem(`moataz_messages_${id}`)
    
    if (currentChat?.id === id) {
      if (updated.length > 0) {
        navigate(`/chat/${updated[0].id}`)
      } else {
        createNewChat()
      }
    }
    toast.success('تم حذف المحادثة')
  }

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Auto resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + 'px'
    }
  }, [input])

  const filteredChats = chats.filter(c => 
    c.title.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const sendMessage = async () => {
    if (!input.trim() || !currentChat || isStreaming) return

    const userMessage: Message = {
      id: generateId('msg'),
      chatId: currentChat.id,
      role: 'user',
      content: input.trim(),
      createdAt: new Date().toISOString(),
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')

    // Update chat title if first message
    let updatedChat = { ...currentChat }
    if (messages.length === 0) {
      updatedChat.title = input.trim().slice(0, 45) + (input.length > 45 ? '...' : '')
      const updatedChats = chats.map(c => c.id === currentChat.id ? updatedChat : c)
      saveChats(updatedChats)
      setCurrentChat(updatedChat)
    }

    // Save user message immediately
    saveMessages(currentChat.id, newMessages)

    try {
      abortControllerRef.current = new AbortController()

      const providerName = selectedProvider?.name || 'Gemini'
      const modelName = selectedModel || 'gemini-1.5-flash'
      const providerType = selectedProvider?.type || 'gemini'

      let content = ''
      let tokens = 0

      if (selectedProvider?.apiKey) {
        // === REAL API CALL (with Streaming when supported) ===
        try {
          const isStreamingSupported = providerType !== 'gemini';

          if (isStreamingSupported) {
            // Real Streaming - word by word from the model
            setStreamingContent('');
            const result = await sendRealStreamingChat({
              providerType,
              apiKey: selectedProvider.apiKey,
              baseUrl: selectedProvider.baseUrl,
              model: modelName,
              messages: newMessages.map(m => ({
                role: m.role,
                content: m.content
              })),
            }, (partialContent) => {
              setStreamingContent(partialContent);
            });
            content = result.content;
            tokens = result.tokens;
          } else {
            // Non-streaming (Gemini or fallback)
            const result = await sendRealChatRequest({
              providerType,
              apiKey: selectedProvider.apiKey,
              baseUrl: selectedProvider.baseUrl,
              model: modelName,
              messages: newMessages.map(m => ({
                role: m.role,
                content: m.content
              })),
            });
            content = result.content;
            tokens = result.tokens;

            // Typing effect for non-streaming
            setStreamingContent('');
            const words = content.split(' ');
            for (let i = 0; i < words.length; i++) {
              await sleep(18 + Math.random() * 28);
              const partial = words.slice(0, i + 1).join(' ');
              setStreamingContent(partial);
            }
          }
        } catch (apiError: any) {
          console.error('Real API Error:', apiError);
          toast.error(apiError.message || 'فشل الاتصال بالمزود. تأكد من صحة المفتاح.');
          // Fallback to mock
          const mock = await generateMockResponse(input, providerName, modelName);
          content = mock.content;
          tokens = mock.tokens;
        }
      } else {
        // === DEMO MODE (no API key) ===
        const mock = await generateMockResponse(input, providerName, modelName, (chunk) => setStreamingContent(chunk))
        content = mock.content
        tokens = mock.tokens
      }

      const assistantMessage: Message = {
        id: generateId('msg'),
        chatId: currentChat.id,
        role: 'assistant',
        content,
        createdAt: new Date().toISOString(),
        model: modelName,
        tokens,
      }

      const finalMessages = [...newMessages, assistantMessage]
      setMessages(finalMessages)
      saveMessages(currentChat.id, finalMessages)
      setStreamingContent('')

      // Update chat metadata
      updatedChat.updatedAt = new Date().toISOString()
      updatedChat.messageCount = finalMessages.length
      const finalChats = chats.map(c => c.id === currentChat.id ? updatedChat : c)
      saveChats(finalChats)
      setCurrentChat(updatedChat)

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        toast.error('حدث خطأ أثناء الحصول على الرد. حاول مرة أخرى.')
      }
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
      abortControllerRef.current = null
    }
  }

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setIsStreaming(false)
    setStreamingContent('')
    toast.info('تم إيقاف التوليد')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const switchMode = (newMode: 'chat' | 'agent') => {
    setMode(newMode)
    if (newMode === 'agent') {
      setShowAgentPanel(true)
      toast.info('تم تفعيل وضع الوكيل. الآن يمكن تنفيذ مهام متعددة الخطوات.')
    } else {
      setShowAgentPanel(false)
    }
    if (currentChat) {
      const updated = chats.map(c => c.id === currentChat.id ? { ...c, mode: newMode } : c)
      saveChats(updated)
      setCurrentChat({ ...currentChat, mode: newMode })
    }
  }

  // Enhanced Agent Mode (stronger simulation)
  const [agentSteps, setAgentSteps] = useState<any[]>([])
  const [isAgentRunning, setIsAgentRunning] = useState(false)

  const runAgentDemo = async () => {
    if (!currentChat || isAgentRunning) return
    
    setShowAgentPanel(true)
    setIsAgentRunning(true)
    
    const initialSteps = [
      { id: 's1', step: 1, title: 'تحليل المهمة', description: 'فهم الطلب وتحديد الأهداف', status: 'completed' },
      { id: 's2', step: 2, title: 'إعداد الخطة', description: 'اختيار الأدوات المناسبة (MCP + GitHub)', status: 'completed' },
      { id: 's3', step: 3, title: 'تنفيذ أداة MCP', description: 'استعلام قاعدة المعرفة', status: 'running' },
      { id: 's4', step: 4, title: 'مراجعة النتائج', description: 'تحليل الإخراج واتخاذ القرار', status: 'pending' },
      { id: 's5', step: 5, title: 'تقديم النتيجة النهائية', description: 'تلخيص وإنهاء المهمة', status: 'pending' },
    ]
    
    setAgentSteps(initialSteps)
    toast.success('بدأ تنفيذ الوكيل المتقدم')

    // Simulate step-by-step execution
    for (let i = 2; i < initialSteps.length; i++) {
      await sleep(1100)
      
      setAgentSteps(prev => {
        const updated = [...prev]
        if (i > 0) updated[i-1].status = 'completed'
        updated[i].status = 'running'
        return updated
      })
      
      if (i === 2) toast.info('جارٍ تنفيذ أداة MCP...')
      if (i === 3) toast.info('جارٍ مراجعة النتائج واتخاذ قرار...')
    }

    await sleep(900)
    
    setAgentSteps(prev => {
      const updated = [...prev]
      updated[updated.length - 1].status = 'completed'
      return updated
    })

    setTimeout(() => {
      toast.success('اكتملت المهمة بنجاح! الوكيل نفذ 5 خطوات.')
      setIsAgentRunning(false)
      // Keep panel open for user to see results
    }, 800)
  }

  const resetAgent = () => {
    setAgentSteps([])
    setShowAgentPanel(false)
    setIsAgentRunning(false)
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sidebar - Chat List */}
      <div className="w-72 border-l border-dark-700 bg-dark-900 flex flex-col hidden lg:flex">
        <div className="p-4 border-b border-dark-700 flex items-center justify-between">
          <div className="font-semibold">المحادثات</div>
          <button onClick={createNewChat} className="btn btn-secondary px-3 py-1.5 text-xs">
            <Plus size={14} /> جديدة
          </button>
        </div>

        <div className="p-3">
          <div className="relative">
            <Search className="absolute right-3 top-3 text-dark-500" size={16} />
            <input 
              type="text" 
              placeholder="ابحث في المحادثات..." 
              className="input py-2 pr-9 text-sm" 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {filteredChats.length > 0 ? filteredChats.map(chat => (
            <div 
              key={chat.id}
              onClick={() => navigate(`/chat/${chat.id}`)}
              className={`group flex items-center justify-between px-4 py-3 rounded-2xl cursor-pointer text-sm transition-all ${currentChat?.id === chat.id ? 'bg-primary-600 text-white' : 'hover:bg-dark-800 text-dark-200'}`}
            >
              <div className="flex-1 min-w-0 pr-2">
                <div className="font-medium truncate">{chat.title}</div>
                <div className="text-[10px] opacity-60 flex items-center gap-1.5 mt-0.5">
                  {chat.model} • {formatDate(chat.updatedAt, { month: 'short', day: 'numeric' })}
                </div>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); deleteChat(chat.id) }}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-black/20 rounded-lg transition"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )) : (
            <div className="px-4 py-8 text-center text-dark-500 text-sm">لا توجد محادثات</div>
          )}
        </div>

        <div className="p-4 border-t border-dark-700 text-[10px] text-dark-500 text-center">
          {chats.length} محادثة محفوظة
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat Header */}
        <div className="h-14 border-b border-dark-700 px-5 flex items-center justify-between bg-dark-900 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <div className="font-semibold text-lg tracking-tight">{currentChat?.title || 'محادثة جديدة'}</div>
              <div className="text-xs text-dark-500 -mt-0.5 flex items-center gap-2">
                {selectedProvider?.name || 'Gemini'} • {selectedModel}
                <span className="inline-block w-px h-3 bg-dark-700 mx-1" />
                {mode === 'agent' ? 'وضع الوكيل' : 'دردشة عادية'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mode Toggle */}
            <div className="flex items-center bg-dark-800 rounded-2xl p-1 text-xs">
              <button 
                onClick={() => switchMode('chat')}
                className={`px-4 py-1.5 rounded-[14px] transition ${mode === 'chat' ? 'bg-white text-dark-950 font-medium' : 'text-dark-400 hover:text-white'}`}
              >
                دردشة
              </button>
              <button 
                onClick={() => switchMode('agent')}
                className={`px-4 py-1.5 rounded-[14px] transition flex items-center gap-1.5 ${mode === 'agent' ? 'bg-white text-dark-950 font-medium' : 'text-dark-400 hover:text-white'}`}
              >
                <Bot size={14} /> وكيل
              </button>
            </div>

            {/* Provider Selector */}
            <div className="relative group">
              <button className="flex items-center gap-2 text-sm px-4 py-2 bg-dark-800 hover:bg-dark-700 rounded-2xl border border-dark-700">
                {selectedProvider?.name || 'اختر مزود'}
                <ChevronDown size={14} />
              </button>
              <div className="absolute left-0 mt-2 w-64 bg-dark-900 border border-dark-700 rounded-2xl shadow-2xl py-1 z-50 hidden group-hover:block">
                {providers.length > 0 ? providers.map(p => (
                  <div 
                    key={p.id} 
                    onClick={() => {
                      setSelectedProvider(p)
                      setSelectedModel(p.model || p.models?.[0] || '')
                    }}
                    className="px-4 py-2.5 hover:bg-dark-800 cursor-pointer text-sm flex justify-between items-center"
                  >
                    {p.name}
                    <span className="text-[10px] text-emerald-400">{p.status}</span>
                  </div>
                )) : (
                  <div className="px-4 py-3 text-sm text-dark-400">أضف مزوداً من صفحة المزودين</div>
                )}
              </div>
            </div>

            {mode === 'agent' && (
              <button onClick={runAgentDemo} className="btn btn-secondary text-xs px-4 py-2">تشغيل وكيل تجريبي</button>
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-dark-950" style={{ scrollbarGutter: 'stable' }}>
          {messages.length === 0 && !isStreaming && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-primary-600/20 to-accent-600/20 flex items-center justify-center mb-6">
                <Bot className="text-primary-400" size={32} />
              </div>
              <h3 className="text-2xl font-semibold tracking-tight mb-2">كيف يمكنني مساعدتك اليوم؟</h3>
              <p className="text-dark-400">اكتب رسالتك أدناه أو جرب وضع الوكيل للمهام المعقدة.</p>
            </div>
          )}

          {messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`message-bubble ${msg.role === 'user' ? 'user-message' : 'assistant-message'}`}>
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 text-xs text-dark-400 mb-2">
                    <Bot size={14} /> {msg.model || selectedModel}
                  </div>
                )}
                
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>

                {msg.tokens && (
                  <div className="text-[10px] text-dark-500 mt-2 text-left">{msg.tokens} رمز</div>
                )}
              </div>
            </div>
          ))}

          {/* Streaming Message */}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="message-bubble assistant-message">
                <div className="flex items-center gap-2 text-xs text-dark-400 mb-2">
                  <Bot size={14} /> {selectedModel} <span className="text-emerald-400">يكتب...</span>
                </div>
                <div className="prose prose-invert prose-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingContent || 'جارٍ التفكير...'}
                  </ReactMarkdown>
                </div>
                <div className="streaming-cursor text-primary-400" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Agent Panel (simple) */}
        {showAgentPanel && mode === 'agent' && (
          <div className="mx-6 mb-4 p-5 bg-dark-900 border border-dark-700 rounded-3xl">
            <div className="flex items-center justify-between mb-4">
              <div className="font-medium flex items-center gap-2">
                <Bot size={18} /> لوحة الوكيل المتقدم
              </div>
              <div className="flex gap-2">
                <button onClick={resetAgent} className="text-xs text-dark-400 hover:text-white">إعادة تعيين</button>
                <button onClick={() => setShowAgentPanel(false)} className="text-xs text-dark-400">إخفاء</button>
              </div>
            </div>

            {agentSteps.length > 0 ? (
              <div className="space-y-3">
                {agentSteps.map((step, idx) => (
                  <div key={idx} className={`agent-step ${step.status}`}>
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-dark-700 flex items-center justify-center text-xs font-mono">
                      {step.step}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{step.title}</div>
                      <div className="text-xs text-dark-400">{step.description}</div>
                    </div>
                    <div className="text-xs">
                      {step.status === 'completed' && <span className="text-emerald-400">✓ تم</span>}
                      {step.status === 'running' && <span className="text-amber-400 animate-pulse">جارٍ التنفيذ...</span>}
                      {step.status === 'pending' && <span className="text-dark-500">قيد الانتظار</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-dark-300">
                اضغط على زر "تشغيل وكيل تجريبي" في الأعلى لبدء تنفيذ مهمة متعددة الخطوات.
              </div>
            )}
          </div>
        )}

        {/* Input Area */}
        <div className="border-t border-dark-700 p-4 bg-dark-900 flex-shrink-0">
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-3 items-end">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={mode === 'agent' ? "صف المهمة التي تريد تنفيذها..." : "اكتب رسالتك هنا... (Shift+Enter لسطر جديد)"}
                  className="textarea w-full pr-4 py-4 text-[15px] leading-relaxed"
                  disabled={isStreaming}
                  rows={1}
                />
              </div>

              <div className="flex gap-2 pb-1">
                {isStreaming ? (
                  <button onClick={stopGeneration} className="btn btn-danger h-12 w-12 p-0 flex items-center justify-center rounded-2xl">
                    <Square size={18} />
                  </button>
                ) : (
                  <button 
                    onClick={sendMessage} 
                    disabled={!input.trim() || !currentChat}
                    className="btn btn-primary h-12 w-12 p-0 flex items-center justify-center rounded-2xl disabled:bg-dark-700"
                  >
                    <Send size={18} />
                  </button>
                )}
              </div>
            </div>

            <div className="text-[10px] text-dark-500 mt-2 text-center flex items-center justify-center gap-4">
              <span>مدعوم بـ {selectedProvider?.name || 'Gemini'}</span>
              <span>•</span>
              <span>اضغط Enter للإرسال</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
