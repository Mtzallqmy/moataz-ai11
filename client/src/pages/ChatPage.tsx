import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Notice, PageHeader } from '../components/ui';
import { reconcileMessageResponse, type ChatMessage, type ToolCall } from '../chat/message-state';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { ChatSummary, ProviderSummary } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;

function ToolTimeline({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null;
  return <div className="tool-timeline">{calls.map((call) => {
    const duration = call.startedAt && call.finishedAt ? Math.max(0, Date.parse(call.finishedAt) - Date.parse(call.startedAt)) : undefined;
    return <details key={call.id} className="tool-card"><summary><strong>{call.name}</strong><span className={`status-badge ${call.status}`}>{call.status}</span>{duration !== undefined && <small>{duration} ms</small>}</summary><pre>{JSON.stringify(call.arguments, null, 2)}</pre>{call.result !== undefined && <pre>{JSON.stringify(call.result, null, 2)}</pre>}{call.error && <p className="error-text">{call.error.code}: {call.error.message}</p>}</details>;
  })}</div>;
}

export function ChatPage({ request, t, language, onNavigate }: { request: Request; t: T; language: Language; onNavigate: (page: 'providers') => void }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [mode, setMode] = useState<'chat' | 'agent'>('agent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);

  const currentChat = useMemo(() => chats.find((chat) => chat.id === current), [chats, current]);
  const verifiedProviders = useMemo(() => providers.filter((provider) => provider.validation_status === 'ready' || provider.is_ready === true), [providers]);
  const selectedProviderRecord = useMemo(() => providers.find((provider) => provider.id === selectedProvider), [providers, selectedProvider]);
  const providerReady = selectedProviderRecord?.validation_status === 'ready' || selectedProviderRecord?.is_ready === true;

  const loadProviders = useCallback(async () => {
    const response = await request<{ providers: ProviderSummary[] }>('/api/providers');
    setProviders(response.providers);
    const firstVerified = response.providers.find((provider) => provider.validation_status === 'ready' || provider.is_ready === true);
    if (!selectedProvider && firstVerified) {
      setSelectedProvider(firstVerified.id);
      setSelectedModel(firstVerified.default_model);
    }
  }, [request, selectedProvider]);

  const loadChats = useCallback(async () => {
    const response = await request<{ chats: ChatSummary[] }>('/api/chats');
    setChats(response.chats);
    return response.chats;
  }, [request]);

  const loadMessages = useCallback(async (id: string) => {
    const response = await request<{ messages: ChatMessage[] }>(`/api/chats/${id}/messages`);
    setMessages(response.messages);
  }, [request]);

  useEffect(() => {
    void Promise.all([loadProviders(), loadChats()]).catch((caught) => setError(formatError(caught, language)));
  }, [language, loadChats, loadProviders]);

  useEffect(() => {
    if (!currentChat) return;
    setSelectedProvider(currentChat.provider_id ?? '');
    setSelectedModel(currentChat.model ?? '');
    setMode(currentChat.mode ?? 'agent');
  }, [currentChat]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, loading]);

  const createChat = async () => {
    if (verifiedProviders.length === 0) {
      setError(language === 'ar' ? 'لا يوجد مزوّد تم اختباره بنجاح. افتح صفحة المزوّدات واضغط اختبار الاتصال.' : 'No verified provider is available. Open Providers and test a connection first.');
      onNavigate('providers');
      return;
    }
    const provider = verifiedProviders.find((entry) => entry.id === selectedProvider) ?? verifiedProviders[0]!;
    setError('');
    try {
      const response = await request<{ id: string }>('/api/chats', {
        method: 'POST',
        body: JSON.stringify({ providerId: provider.id, model: selectedModel || provider.default_model, mode })
      });
      await loadChats();
      setCurrent(response.id);
      setSelectedProvider(provider.id);
      setSelectedModel(selectedModel || provider.default_model);
      setMessages([]);
    } catch (caught) {
      setError(formatError(caught, language));
    }
  };

  const openChat = async (chat: ChatSummary) => {
    setCurrent(chat.id);
    setError('');
    try { await loadMessages(chat.id); }
    catch (caught) { setError(formatError(caught, language)); }
  };

  const updateConversation = async (next: { providerId?: string | null; model?: string | null; mode?: 'chat' | 'agent' }) => {
    if (!current) return;
    setError('');
    try {
      await request(`/api/chats/${current}`, { method: 'PATCH', body: JSON.stringify(next) });
      await loadChats();
    } catch (caught) {
      setError(formatError(caught, language));
    }
  };

  const changeProvider = async (providerId: string) => {
    const provider = providers.find((entry) => entry.id === providerId);
    setSelectedProvider(providerId);
    setSelectedModel(provider?.default_model ?? '');
    if (current) await updateConversation({ providerId, model: provider?.default_model ?? null });
  };

  const deleteChat = async () => {
    if (!current || !window.confirm(language === 'ar' ? 'حذف المحادثة نهائيًا؟' : 'Delete this conversation?')) return;
    try {
      await request(`/api/chats/${current}`, { method: 'DELETE' });
      setCurrent(null);
      setMessages([]);
      await loadChats();
    } catch (caught) {
      setError(formatError(caught, language));
    }
  };

  const send = async () => {
    if (!current || !input.trim() || loading || !providerReady) {
      if (!providerReady) setError(language === 'ar' ? 'اختبر المزوّد بنجاح قبل إرسال الرسائل.' : 'Verify the provider before sending messages.');
      return;
    }
    const content = input.trim();
    const temporaryId = `temp-${crypto.randomUUID()}`;
    const key = crypto.randomUUID();
    setInput('');
    setError('');
    setLoading(true);
    setMessages((previous) => [...previous, { id: temporaryId, role: 'user', content, tool_calls: [] }]);
    try {
      const response = await request<{ userMessage?: ChatMessage; message: ChatMessage }>(`/api/chats/${current}/messages`, {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ content })
      });
      setMessages((previous) => reconcileMessageResponse(previous, temporaryId, response.userMessage, response.message));
      await loadChats();
    } catch (caught) {
      setMessages((previous) => previous.filter((message) => message.id !== temporaryId));
      setError(formatError(caught, language));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-page">
      <PageHeader title={t('chat')} description={language === 'ar' ? 'اختر مزوّدًا تم اختباره ونموذجًا لكل محادثة. وضع الوكيل يستخدم الاستدعاء الرسمي للأدوات عندما يدعمه المزود.' : 'Choose a verified provider and model per conversation. Agent mode uses native tool calling when the provider supports it.'} actions={<button type="button" onClick={() => { void createChat(); }}>{t('newChat')}</button>} />
      {error && <Notice tone="error" onDismiss={() => setError('')}><pre>{error}</pre></Notice>}
      <div className="chat-workspace">
        <aside className="conversation-list">
          <div className="conversation-list-header"><strong>{t('chat')}</strong><span>{chats.length}</span></div>
          {chats.length === 0 ? <EmptyState title={t('noChats')} /> : chats.map((chat) => <button type="button" key={chat.id} className={`conversation-item ${current === chat.id ? 'active' : ''}`} onClick={() => { void openChat(chat); }}><strong>{chat.title || 'Chat'}</strong><small>{chat.provider_name || t('selectProvider')} · {chat.mode === 'chat' ? t('simpleChat') : t('agentMode')}</small>{!chat.provider_available && chat.provider_id && <span className="warning-dot" title={t('providerRequired')} />}</button>)}
        </aside>

        <section className="conversation-panel">
          <div className="conversation-toolbar">
            <label><span>{t('selectProvider')}</span><select value={selectedProvider} onChange={(event) => { void changeProvider(event.target.value); }} disabled={providers.length === 0}><option value="">—</option>{providers.map((provider) => <option key={provider.id} value={provider.id} disabled={provider.validation_status !== 'ready' && provider.is_ready !== true}>{provider.name} · {provider.type} · {provider.validation_status === 'ready' || provider.is_ready === true ? t('verified') : t('untested')}</option>)}</select></label>
            <label><span>{t('selectModel')}</span><input value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} onBlur={() => { if (current) void updateConversation({ model: selectedModel || null }); }} /></label>
            <label><span>{t('chatMode')}</span><select value={mode} onChange={(event) => { const next = event.target.value as 'chat' | 'agent'; setMode(next); if (current) void updateConversation({ mode: next }); }}><option value="agent">{t('agentMode')}</option><option value="chat">{t('simpleChat')}</option></select></label>
            {current && <button type="button" className="danger ghost compact" onClick={() => { void deleteChat(); }}>{t('delete')}</button>}
          </div>

          <div className="messages" ref={messagesRef}>
            {!current && <EmptyState title={providers.length === 0 ? t('noProviders') : t('noChats')} description={providers.length === 0 ? t('providerRequired') : undefined} action={providers.length === 0 ? <button type="button" onClick={() => onNavigate('providers')}>{t('providers')}</button> : <button type="button" onClick={() => { void createChat(); }}>{t('newChat')}</button>} />}
            {messages.map((message) => <article key={message.id} className={`msg ${message.role}`}><div className="message-role">{message.role === 'user' ? (language === 'ar' ? 'أنت' : 'You') : 'Moataz AI'}</div><pre>{message.content}</pre><ToolTimeline calls={Array.isArray(message.tool_calls) ? message.tool_calls : []} /></article>)}
            {loading && <div className="typing" aria-label={t('loading')}><span /><span /><span /></div>}
          </div>
          {current && <div className="composer"><textarea rows={2} placeholder={t('message')} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} /><button type="button" onClick={() => { void send(); }} disabled={!input.trim() || loading || !selectedProvider || !providerReady}>{t('send')}</button></div>}
        </section>
      </div>
    </div>
  );
}
