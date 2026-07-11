import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Notice, PageHeader, SpinnerLabel } from '../components/ui';
import { reconcileMessageResponse, type ChatMessage, type ToolCall } from '../chat/message-state';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { AttachmentSummary, ChatMode, ChatSummary, ProviderSummary } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type PendingAttachment = AttachmentSummary & { localKey: string };

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentIcon(kind: AttachmentSummary['kind']): string {
  if (kind === 'image') return '🖼️';
  if (kind === 'archive') return '🗜️';
  if (kind === 'text') return '📄';
  return '📎';
}

function AttachmentList({ attachments, onRemove }: { attachments: readonly (AttachmentSummary | PendingAttachment)[]; onRemove?: (id: string) => void }) {
  if (attachments.length === 0) return null;
  return <div className="attachment-list">{attachments.map((attachment) => <div className="attachment-chip" key={attachment.id}>
    <span className="attachment-kind" aria-hidden="true">{attachmentIcon(attachment.kind)}</span>
    <span className="attachment-copy"><strong>{attachment.name}</strong><small>{formatBytes(attachment.size_bytes)} · {attachment.mime_type}</small></span>
    {onRemove && <button type="button" className="icon-button attachment-remove" aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment.id)}>×</button>}
  </div>)}</div>;
}

function ToolTimeline({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null;
  return <div className="tool-timeline">{calls.map((call) => {
    const duration = call.startedAt && call.finishedAt ? Math.max(0, Date.parse(call.finishedAt) - Date.parse(call.startedAt)) : undefined;
    const label = call.name.startsWith('agent:') ? call.name.replace('agent:', 'Agent · ') : call.name;
    return <details key={call.id} className="tool-card"><summary><strong>{label}</strong><span className={`status-badge ${call.status}`}>{call.status}</span>{duration !== undefined && <small>{duration} ms</small>}</summary><pre>{JSON.stringify(call.arguments, null, 2)}</pre>{call.result !== undefined && <pre>{JSON.stringify(call.result, null, 2)}</pre>}{call.error && <p className="error-text">{call.error.code}: {call.error.message}</p>}</details>;
  })}</div>;
}

export function ChatPage({ request, t, language, onNavigate }: { request: Request; t: T; language: Language; onNavigate: (page: 'providers') => void }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [current, setCurrent] = useState<string | null>(() => localStorage.getItem('moataz_current_chat'));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(() => localStorage.getItem('moataz_chat_draft') ?? '');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [mode, setMode] = useState<ChatMode>('agent');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentChat = useMemo(() => chats.find((chat) => chat.id === current), [chats, current]);
  const verifiedProviders = useMemo(() => providers.filter((provider) => provider.validation_status === 'verified'), [providers]);
  const selectedProviderRecord = useMemo(() => providers.find((provider) => provider.id === selectedProvider), [providers, selectedProvider]);
  const providerReady = selectedProviderRecord?.validation_status === 'verified';

  const loadProviders = useCallback(async () => {
    const response = await request<{ providers: ProviderSummary[] }>('/api/providers');
    setProviders(response.providers);
    const firstVerified = response.providers.find((provider) => provider.validation_status === 'verified');
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
    void (async () => {
      try {
        const [, loadedChats] = await Promise.all([loadProviders(), loadChats()]);
        const remembered = localStorage.getItem('moataz_current_chat');
        const target = loadedChats.find((chat) => chat.id === remembered);
        if (target) {
          setCurrent(target.id);
          await loadMessages(target.id);
        } else if (remembered) {
          localStorage.removeItem('moataz_current_chat');
          setCurrent(null);
        }
      } catch (caught) {
        setError(formatError(caught, language));
      }
    })();
  }, [language, loadChats, loadMessages, loadProviders]);

  useEffect(() => {
    localStorage.setItem('moataz_chat_draft', input);
  }, [input]);

  useEffect(() => {
    if (!currentChat) return;
    setSelectedProvider(currentChat.provider_id ?? '');
    setSelectedModel(currentChat.model ?? '');
    setMode(currentChat.mode ?? 'agent');
  }, [currentChat]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, loading]);

  const createChat = async (): Promise<string | null> => {
    if (verifiedProviders.length === 0) {
      setError(language === 'ar' ? 'لا يوجد مزوّد تم اختباره بنجاح. افتح صفحة المزوّدات واستخدم «حفظ وفحص».' : 'No verified provider is available. Open Providers and use Save & verify.');
      onNavigate('providers');
      return null;
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
      localStorage.setItem('moataz_current_chat', response.id);
      setSelectedProvider(provider.id);
      setSelectedModel(selectedModel || provider.default_model);
      setMessages([]);
      setPendingAttachments([]);
      return response.id;
    } catch (caught) {
      setError(formatError(caught, language));
      return null;
    }
  };

  const openChat = async (chat: ChatSummary) => {
    setCurrent(chat.id);
    localStorage.setItem('moataz_current_chat', chat.id);
    setPendingAttachments([]);
    setError('');
    try { await loadMessages(chat.id); }
    catch (caught) { setError(formatError(caught, language)); }
  };

  const updateConversation = async (next: { providerId?: string | null; model?: string | null; mode?: ChatMode }) => {
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
    if (!current || !window.confirm(language === 'ar' ? 'حذف المحادثة وملفاتها نهائيًا؟' : 'Delete this conversation and its attachments?')) return;
    try {
      await request(`/api/chats/${current}`, { method: 'DELETE' });
      setCurrent(null);
      localStorage.removeItem('moataz_current_chat');
      setMessages([]);
      setPendingAttachments([]);
      await loadChats();
    } catch (caught) {
      setError(formatError(caught, language));
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let chatId = current;
    if (!chatId) chatId = await createChat();
    if (!chatId) return;
    const selected = [...files].slice(0, Math.max(0, MAX_ATTACHMENTS - pendingAttachments.length));
    const tooLarge = selected.find((file) => file.size > MAX_UPLOAD_BYTES);
    if (tooLarge) {
      setError(language === 'ar' ? `الملف ${tooLarge.name} أكبر من 10 MB.` : `${tooLarge.name} is larger than 10 MB.`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const uploaded: PendingAttachment[] = [];
      for (const file of selected) {
        const response = await request<{ attachment: AttachmentSummary }>(`/api/chats/${chatId}/attachments`, {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name)
          },
          body: file
        });
        uploaded.push({ ...response.attachment, localKey: crypto.randomUUID() });
      }
      setPendingAttachments((previous) => [...previous, ...uploaded].slice(0, MAX_ATTACHMENTS));
    } catch (caught) {
      setError(formatError(caught, language));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePendingAttachment = async (id: string) => {
    if (!current) return;
    const snapshot = pendingAttachments;
    setPendingAttachments((previous) => previous.filter((attachment) => attachment.id !== id));
    try {
      await request(`/api/chats/${current}/attachments/${id}`, { method: 'DELETE' });
    } catch (caught) {
      setPendingAttachments(snapshot);
      setError(formatError(caught, language));
    }
  };

  const send = async () => {
    if (!current || (!input.trim() && pendingAttachments.length === 0) || loading || !providerReady) {
      if (!providerReady) setError(language === 'ar' ? 'اختبر المزوّد بنجاح قبل إرسال الرسائل.' : 'Verify the provider before sending messages.');
      return;
    }
    if (mode === 'multi-agent' && verifiedProviders.length < 2) {
      setError(language === 'ar' ? 'وضع الوكلاء المتعددين يحتاج مزوّدين متحققين على الأقل.' : 'Multi-agent mode needs at least two verified providers.');
      return;
    }
    const content = input.trim();
    const attachments = pendingAttachments;
    const temporaryId = `temp-${crypto.randomUUID()}`;
    const key = crypto.randomUUID();
    setInput('');
    localStorage.removeItem('moataz_chat_draft');
    setPendingAttachments([]);
    setError('');
    setLoading(true);
    setMessages((previous) => [...previous, {
      id: temporaryId,
      role: 'user',
      content: content || `📎 ${attachments.map((attachment) => attachment.name).join(', ')}`,
      tool_calls: [],
      attachments
    }]);
    try {
      const response = await request<{ userMessage?: ChatMessage; message: ChatMessage }>(`/api/chats/${current}/messages`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ content, attachmentIds: attachments.map((attachment) => attachment.id) })
      });
      setMessages((previous) => reconcileMessageResponse(previous, temporaryId, response.userMessage, response.message));
      await Promise.all([loadChats(), loadProviders()]);
    } catch (caught) {
      setMessages((previous) => previous.filter((message) => message.id !== temporaryId));
      setInput(content);
      setPendingAttachments(attachments);
      setError(formatError(caught, language));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-page">
      <PageHeader title={t('chat')} description={language === 'ar' ? 'محادثات محفوظة مع صور وملفات نصية ومضغوطة. يمكن اختيار Chat أو Agent أو وكلاء متعددين عند توفر أكثر من مزوّد.' : 'Persistent chats with images, text files, and ZIP archives. Choose Chat, Agent, or Multi-agent when multiple providers are available.'} actions={<button type="button" onClick={() => { void createChat(); }}>{t('newChat')}</button>} />
      {error && <Notice tone="error" onDismiss={() => setError('')}><pre>{error}</pre></Notice>}
      <div className="chat-workspace">
        <aside className="conversation-list">
          <div className="conversation-list-header"><strong>{t('chat')}</strong><span>{chats.length}</span></div>
          {chats.length === 0 ? <EmptyState title={t('noChats')} /> : chats.map((chat) => <button type="button" key={chat.id} className={`conversation-item ${current === chat.id ? 'active' : ''}`} onClick={() => { void openChat(chat); }}><strong>{chat.title || 'Chat'}</strong><small>{chat.provider_name || t('selectProvider')} · {chat.mode === 'chat' ? t('simpleChat') : chat.mode === 'multi-agent' ? (language === 'ar' ? 'وكلاء متعددون' : 'Multi-agent') : t('agentMode')}</small>{!chat.provider_available && chat.provider_id && <span className="warning-dot" title={t('providerRequired')} />}</button>)}
        </aside>

        <section className="conversation-panel">
          <div className="conversation-toolbar">
            <label><span>{t('selectProvider')}</span><select value={selectedProvider} onChange={(event) => { void changeProvider(event.target.value); }} disabled={providers.length === 0}><option value="">—</option>{providers.map((provider) => <option key={provider.id} value={provider.id} disabled={provider.validation_status !== 'verified'}>{provider.name} · {provider.type} · {provider.validation_status === 'verified' ? t('verified') : t('untested')}</option>)}</select></label>
            <label><span>{t('selectModel')}</span><input value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} onBlur={() => { if (current) void updateConversation({ model: selectedModel || null }); }} placeholder="auto" /></label>
            <label><span>{t('chatMode')}</span><select value={mode} onChange={(event) => { const next = event.target.value as ChatMode; setMode(next); if (current) void updateConversation({ mode: next }); }}><option value="agent">{t('agentMode')}</option><option value="chat">{t('simpleChat')}</option><option value="multi-agent" disabled={verifiedProviders.length < 2}>{language === 'ar' ? `وكلاء متعددون (${verifiedProviders.length})` : `Multi-agent (${verifiedProviders.length})`}</option></select></label>
            {current && <button type="button" className="danger ghost compact" onClick={() => { void deleteChat(); }}>{t('delete')}</button>}
          </div>

          <div className="messages" ref={messagesRef}>
            {!current && <EmptyState title={providers.length === 0 ? t('noProviders') : t('noChats')} description={providers.length === 0 ? t('providerRequired') : undefined} action={providers.length === 0 ? <button type="button" onClick={() => onNavigate('providers')}>{t('providers')}</button> : <button type="button" onClick={() => { void createChat(); }}>{t('newChat')}</button>} />}
            {messages.map((message) => <article key={message.id} className={`msg ${message.role}`}><div className="message-role">{message.role === 'user' ? (language === 'ar' ? 'أنت' : 'You') : 'Moataz AI'}</div><pre>{message.content}</pre><AttachmentList attachments={message.attachments ?? []} /><ToolTimeline calls={Array.isArray(message.tool_calls) ? message.tool_calls : []} /></article>)}
            {loading && <div className="typing" aria-label={t('loading')}><span /><span /><span /></div>}
          </div>
          {current && <div className="composer-shell">
            <AttachmentList attachments={pendingAttachments} onRemove={(id) => { void removePendingAttachment(id); }} />
            <div className="composer">
              <input ref={fileInputRef} className="visually-hidden" type="file" multiple accept="image/*,.txt,.md,.json,.jsonl,.csv,.xml,.yaml,.yml,.toml,.js,.ts,.tsx,.jsx,.css,.html,.py,.java,.kt,.go,.rs,.php,.rb,.sh,.sql,.zip,application/zip" onChange={(event) => { void uploadFiles(event.target.files); }} />
              <button type="button" className="icon-button attach-button" title={language === 'ar' ? 'إضافة ملفات أو صور' : 'Add files or images'} onClick={() => fileInputRef.current?.click()} disabled={uploading || loading || pendingAttachments.length >= MAX_ATTACHMENTS}>{uploading ? '…' : '＋'}</button>
              <textarea rows={2} placeholder={language === 'ar' ? 'اكتب رسالة، أو أرفق ملفات وصورًا…' : 'Write a message, or attach files and images…'} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} />
              <button type="button" onClick={() => { void send(); }} disabled={(!input.trim() && pendingAttachments.length === 0) || loading || uploading || !selectedProvider || !providerReady}><SpinnerLabel active={loading} activeText={language === 'ar' ? 'جارٍ التنفيذ…' : 'Running…'} idleText={t('send')} /></button>
            </div>
            <small className="composer-hint">{language === 'ar' ? 'حتى 8 ملفات، 10 MB للملف. الصور تُرسل للنموذج الداعم للرؤية، والملفات المضغوطة تُفهرس ويعالجها Sandbox عند توفره.' : 'Up to 8 files, 10 MB each. Images are sent to vision-capable models; ZIP files are indexed and can be processed by the sandbox.'}</small>
          </div>}
        </section>
      </div>
    </div>
  );
}
