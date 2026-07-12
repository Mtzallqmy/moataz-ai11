import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, Notice, PageHeader, SpinnerLabel } from '../components/ui';
import { reconcileMessageResponse, type ChatMessage, type ToolCall } from '../chat/message-state';
import { readSse } from '../chat/sse';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { AttachmentSummary, ChatMode, ChatSummary, ProviderSummary } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type StreamRequest = (path: string, options?: RequestInit) => Promise<Response>;
type PendingAttachment = AttachmentSummary & { localKey: string };
type RequestStage = 'idle' | 'connecting' | 'waiting_for_model' | 'receiving' | 'completed' | 'failed' | 'cancelled';
type ModelResponse = { supported: boolean; models: string[]; recommendedModel?: string | null };

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

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function messageOf(value: unknown): ChatMessage | undefined {
  const record = recordOf(value);
  if (!record || typeof record.id !== 'string' || (record.role !== 'user' && record.role !== 'assistant') || typeof record.content !== 'string') return undefined;
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    status: typeof record.status === 'string' ? record.status : undefined,
    tool_calls: Array.isArray(record.tool_calls) ? record.tool_calls as ToolCall[] : [],
    attachments: Array.isArray(record.attachments) ? record.attachments as AttachmentSummary[] : []
  };
}

function stageText(stage: RequestStage, language: Language): string {
  const labels: Record<RequestStage, { ar: string; en: string }> = {
    idle: { ar: '', en: '' },
    connecting: { ar: 'جارٍ الاتصال بالمزود', en: 'Connecting to provider' },
    waiting_for_model: { ar: 'جارٍ انتظار النموذج', en: 'Waiting for model' },
    receiving: { ar: 'جارٍ استقبال الرد', en: 'Receiving response' },
    completed: { ar: 'اكتمل', en: 'Completed' },
    failed: { ar: 'فشل الطلب', en: 'Request failed' },
    cancelled: { ar: 'تم إلغاء الطلب', en: 'Request cancelled' }
  };
  return labels[stage][language];
}

export function ChatPage({ request, streamRequest, t, language, onNavigate }: {
  request: Request;
  streamRequest: StreamRequest;
  t: T;
  language: Language;
  onNavigate: (page: 'providers') => void;
}) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [current, setCurrent] = useState<string | null>(() => localStorage.getItem('moataz_current_chat'));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(() => localStorage.getItem('moataz_chat_draft') ?? '');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [mode, setMode] = useState<ChatMode>('agent');
  const [loading, setLoading] = useState(false);
  const [requestStage, setRequestStage] = useState<RequestStage>('idle');
  const [uploading, setUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeControllerRef = useRef<AbortController | null>(null);

  const currentChat = useMemo(() => chats.find((chat) => chat.id === current), [chats, current]);
  const verifiedProviders = useMemo(() => providers.filter((provider) => provider.validation_status === 'verified'), [providers]);
  const selectedProviderRecord = useMemo(() => providers.find((provider) => provider.id === selectedProvider), [providers, selectedProvider]);
  const providerReady = selectedProviderRecord?.validation_status === 'verified';
  const modelReady = Boolean(selectedModel.trim()) && selectedModel.trim().toLowerCase() !== 'auto';

  const loadProviders = useCallback(async () => {
    const response = await request<{ providers: ProviderSummary[] }>('/api/providers');
    setProviders(response.providers);
    return response.providers;
  }, [request]);

  const loadChats = useCallback(async () => {
    const response = await request<{ chats: ChatSummary[] }>('/api/chats');
    setChats(response.chats);
    return response.chats;
  }, [request]);

  const loadMessages = useCallback(async (id: string) => {
    const response = await request<{ messages: ChatMessage[] }>(`/api/chats/${id}/messages`);
    setMessages(response.messages);
  }, [request]);

  const loadProviderModels = useCallback(async (providerId: string, preferredModel?: string | null): Promise<string> => {
    if (!providerId) {
      setModelOptions([]);
      setSelectedModel('');
      return '';
    }
    const provider = providers.find((entry) => entry.id === providerId);
    setModelsLoading(true);
    try {
      const response = await request<ModelResponse>(`/api/providers/${providerId}/models`);
      const models = [...new Set(response.models.filter((model) => model.trim() && model.trim().toLowerCase() !== 'auto'))];
      const configured = preferredModel?.trim() || provider?.default_model?.trim() || '';
      const nextModel = configured && configured.toLowerCase() !== 'auto' && (models.length === 0 || models.includes(configured))
        ? configured
        : models[0] ?? (configured.toLowerCase() !== 'auto' ? configured : '');
      setModelOptions(models);
      setSelectedModel(nextModel);
      return nextModel;
    } catch (caught) {
      const configured = preferredModel?.trim() || provider?.default_model?.trim() || '';
      const fallback = configured.toLowerCase() === 'auto' ? '' : configured;
      setModelOptions(fallback ? [fallback] : []);
      setSelectedModel(fallback);
      setError(formatError(caught, language));
      return fallback;
    } finally {
      setModelsLoading(false);
    }
  }, [language, providers, request]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loadedProviders, loadedChats] = await Promise.all([loadProviders(), loadChats()]);
        if (cancelled) return;
        const remembered = localStorage.getItem('moataz_current_chat');
        const target = loadedChats.find((chat) => chat.id === remembered);
        const firstVerified = loadedProviders.find((provider) => provider.validation_status === 'verified');
        if (target) {
          setCurrent(target.id);
          setSelectedProvider(target.provider_id ?? '');
          setSelectedModel(target.model ?? '');
          setMode(target.mode ?? 'agent');
          await Promise.all([
            loadMessages(target.id),
            target.provider_id ? loadProviderModels(target.provider_id, target.model) : Promise.resolve('')
          ]);
        } else {
          if (remembered) localStorage.removeItem('moataz_current_chat');
          setCurrent(null);
          if (firstVerified) {
            setSelectedProvider(firstVerified.id);
            await loadProviderModels(firstVerified.id, firstVerified.default_model);
          }
        }
      } catch (caught) {
        if (!cancelled) setError(formatError(caught, language));
      }
    })();
    return () => { cancelled = true; activeControllerRef.current?.abort(); };
  }, [language, loadChats, loadMessages, loadProviderModels, loadProviders]);

  useEffect(() => { localStorage.setItem('moataz_chat_draft', input); }, [input]);

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
      setError(language === 'ar' ? 'لا يوجد مزوّد تم اختباره بنجاح.' : 'No verified provider is available.');
      onNavigate('providers');
      return null;
    }
    const provider = verifiedProviders.find((entry) => entry.id === selectedProvider) ?? verifiedProviders[0]!;
    const model = provider.id === selectedProvider && modelReady
      ? selectedModel.trim()
      : await loadProviderModels(provider.id, provider.default_model);
    if (!model || model.toLowerCase() === 'auto') {
      setError(language === 'ar' ? 'اختر Model ID فعليًا قبل إنشاء المحادثة.' : 'Choose an actual model ID before creating the chat.');
      return null;
    }
    setError('');
    try {
      const response = await request<{ id: string }>('/api/chats', {
        method: 'POST',
        body: JSON.stringify({ providerId: provider.id, model, mode })
      });
      await loadChats();
      setCurrent(response.id);
      localStorage.setItem('moataz_current_chat', response.id);
      setSelectedProvider(provider.id);
      setSelectedModel(model);
      setMessages([]);
      setPendingAttachments([]);
      return response.id;
    } catch (caught) {
      setError(formatError(caught, language));
      return null;
    }
  };

  const openChat = async (chat: ChatSummary) => {
    activeControllerRef.current?.abort();
    setCurrent(chat.id);
    localStorage.setItem('moataz_current_chat', chat.id);
    setPendingAttachments([]);
    setError('');
    setSelectedProvider(chat.provider_id ?? '');
    setMode(chat.mode ?? 'agent');
    try {
      await Promise.all([
        loadMessages(chat.id),
        chat.provider_id ? loadProviderModels(chat.provider_id, chat.model) : Promise.resolve('')
      ]);
    } catch (caught) { setError(formatError(caught, language)); }
  };

  const updateConversation = async (next: { providerId?: string | null; model?: string | null; mode?: ChatMode }) => {
    if (!current) return;
    setError('');
    try {
      await request(`/api/chats/${current}`, { method: 'PATCH', body: JSON.stringify(next) });
      await loadChats();
    } catch (caught) { setError(formatError(caught, language)); }
  };

  const changeProvider = async (providerId: string) => {
    activeControllerRef.current?.abort();
    setSelectedProvider(providerId);
    setSelectedModel('');
    setModelOptions([]);
    const model = await loadProviderModels(providerId);
    if (current) await updateConversation({ providerId: providerId || null, model: model || null });
  };

  const changeModel = async (model: string) => {
    setSelectedModel(model);
    if (current && model.trim() && model.trim().toLowerCase() !== 'auto') await updateConversation({ model: model.trim() });
  };

  const deleteChat = async () => {
    if (!current || !window.confirm(language === 'ar' ? 'حذف المحادثة وملفاتها نهائيًا؟' : 'Delete this conversation and its attachments?')) return;
    activeControllerRef.current?.abort();
    try {
      await request(`/api/chats/${current}`, { method: 'DELETE' });
      setCurrent(null);
      localStorage.removeItem('moataz_current_chat');
      setMessages([]);
      setPendingAttachments([]);
      await loadChats();
    } catch (caught) { setError(formatError(caught, language)); }
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
    setUploading(true); setError('');
    try {
      const uploaded: PendingAttachment[] = [];
      for (const file of selected) {
        const response = await request<{ attachment: AttachmentSummary }>(`/api/chats/${chatId}/attachments`, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
          body: file
        });
        uploaded.push({ ...response.attachment, localKey: crypto.randomUUID() });
      }
      setPendingAttachments((previous) => [...previous, ...uploaded].slice(0, MAX_ATTACHMENTS));
    } catch (caught) { setError(formatError(caught, language)); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePendingAttachment = async (id: string) => {
    if (!current) return;
    const snapshot = pendingAttachments;
    setPendingAttachments((previous) => previous.filter((attachment) => attachment.id !== id));
    try { await request(`/api/chats/${current}/attachments/${id}`, { method: 'DELETE' }); }
    catch (caught) { setPendingAttachments(snapshot); setError(formatError(caught, language)); }
  };

  const sendBuffered = async (chatId: string, content: string, attachments: PendingAttachment[], temporaryId: string, key: string) => {
    setRequestStage('connecting');
    const response = await request<{ userMessage?: ChatMessage; message: ChatMessage }>(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({
        providerId: selectedProvider,
        model: selectedModel.trim(),
        stream: false,
        content,
        attachmentIds: attachments.map((attachment) => attachment.id)
      })
    });
    setMessages((previous) => reconcileMessageResponse(previous, temporaryId, response.userMessage, response.message));
    setRequestStage('completed');
  };

  const sendStreaming = async (chatId: string, content: string, attachments: PendingAttachment[], temporaryId: string, key: string) => {
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const temporaryAssistantId = `stream-${crypto.randomUUID()}`;
    let receivedUser = false;
    let assistantCreated = false;
    let completed = false;
    setRequestStage('connecting');

    const response = await streamRequest(`/api/chats/${chatId}/messages/stream`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      signal: controller.signal,
      body: JSON.stringify({
        providerId: selectedProvider,
        model: selectedModel.trim(),
        stream: true,
        content,
        attachmentIds: attachments.map((attachment) => attachment.id)
      })
    });

    for await (const event of readSse(response)) {
      const data = recordOf(event.data);
      if (event.event === 'status') {
        const stage = data?.stage;
        if (stage === 'connecting' || stage === 'waiting_for_model' || stage === 'completed') setRequestStage(stage);
        continue;
      }
      if (event.event === 'user_message') {
        const persisted = messageOf(data?.message);
        if (persisted) {
          receivedUser = true;
          setMessages((previous) => previous.map((message) => message.id === temporaryId ? persisted : message));
        }
        continue;
      }
      if (event.event === 'delta') {
        const text = typeof data?.text === 'string' ? data.text : '';
        if (!text) continue;
        setRequestStage('receiving');
        setMessages((previous) => {
          const index = previous.findIndex((message) => message.id === temporaryAssistantId);
          if (index < 0) {
            assistantCreated = true;
            return [...previous, { id: temporaryAssistantId, role: 'assistant', content: text, status: 'partial', tool_calls: [] }];
          }
          return previous.map((message, messageIndex) => messageIndex === index ? { ...message, content: message.content + text, status: 'partial' } : message);
        });
        continue;
      }
      if (event.event === 'completed') {
        const persisted = messageOf(data?.message);
        if (!persisted) throw new Error('Streaming completed without a valid assistant message.');
        completed = true;
        setMessages((previous) => {
          const withoutTemporary = previous.filter((message) => message.id !== temporaryAssistantId);
          return withoutTemporary.some((message) => message.id === persisted.id)
            ? withoutTemporary.map((message) => message.id === persisted.id ? persisted : message)
            : [...withoutTemporary, persisted];
        });
        setRequestStage('completed');
        continue;
      }
      if (event.event === 'error') {
        const message = typeof data?.message === 'string' ? data.message : (language === 'ar' ? 'فشل بث المزود.' : 'Provider streaming failed.');
        setMessages((previous) => previous.map((item) => item.id === temporaryAssistantId ? { ...item, status: 'partial' } : item));
        setRequestStage('failed');
        throw new Error(message);
      }
    }

    if (!completed) throw new Error(language === 'ar' ? 'أُغلق البث قبل حدث الاكتمال.' : 'The stream closed before the completion event.');
    if (!receivedUser) {
      await loadMessages(chatId);
    } else if (!assistantCreated) {
      // The completed event already inserted the assistant message; no action required.
    }
  };

  const send = async () => {
    if (!current || (!input.trim() && pendingAttachments.length === 0) || loading || !providerReady || !modelReady) {
      if (!providerReady) setError(language === 'ar' ? 'اختر مزودًا متصلًا ومتحققًا.' : 'Choose a connected, verified provider.');
      else if (!modelReady) setError(language === 'ar' ? 'اختر Model ID فعليًا للمزود الحالي.' : 'Choose an actual model ID for the current provider.');
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
    setRequestStage('connecting');
    setMessages((previous) => [...previous, {
      id: temporaryId,
      role: 'user',
      content: content || `📎 ${attachments.map((attachment) => attachment.name).join(', ')}`,
      status: 'completed',
      tool_calls: [],
      attachments
    }]);
    try {
      const useStreaming = mode === 'chat' && selectedProviderRecord?.streaming_enabled !== false;
      if (useStreaming) await sendStreaming(current, content, attachments, temporaryId, key);
      else await sendBuffered(current, content, attachments, temporaryId, key);
      await Promise.all([loadChats(), loadProviders()]);
    } catch (caught) {
      const aborted = caught instanceof DOMException && caught.name === 'AbortError';
      if (!aborted) {
        setError(formatError(caught, language));
        setRequestStage('failed');
      } else {
        setRequestStage('cancelled');
      }
      const hasPersistedOrPartial = messages.some((message) => message.id === temporaryId || message.status === 'partial');
      if (!hasPersistedOrPartial) {
        setMessages((previous) => previous.filter((message) => message.id !== temporaryId));
        setInput(content);
        setPendingAttachments(attachments);
      }
      await loadMessages(current).catch(() => undefined);
    } finally {
      activeControllerRef.current = null;
      setLoading(false);
    }
  };

  const cancelRequest = () => {
    activeControllerRef.current?.abort();
    setRequestStage('cancelled');
  };

  return <div className="chat-page">
    <PageHeader title={t('chat')} description={language === 'ar' ? 'المحادثة تستخدم المزود والنموذج المحددين فقط. لا يرسل المتصفح API key أو Base URL.' : 'Chat uses only the selected provider and model. The browser never sends the API key or base URL.'} actions={<button type="button" onClick={() => { void createChat(); }}>{t('newChat')}</button>} />
    {error && <Notice tone="error" onDismiss={() => setError('')}><pre>{error}</pre></Notice>}
    {requestStage !== 'idle' && <Notice tone={requestStage === 'failed' ? 'error' : requestStage === 'completed' ? 'success' : 'info'}><span>{stageText(requestStage, language)}</span></Notice>}
    <div className="chat-workspace">
      <aside className="conversation-list">
        <div className="conversation-list-header"><strong>{t('chat')}</strong><span>{chats.length}</span></div>
        {chats.length === 0 ? <EmptyState title={t('noChats')} /> : chats.map((chat) => <button type="button" key={chat.id} className={`conversation-item ${current === chat.id ? 'active' : ''}`} onClick={() => { void openChat(chat); }}><strong>{chat.title || 'Chat'}</strong><small>{chat.provider_name || t('selectProvider')} · {chat.model || '—'} · {chat.mode === 'chat' ? t('simpleChat') : chat.mode === 'multi-agent' ? (language === 'ar' ? 'وكلاء متعددون' : 'Multi-agent') : t('agentMode')}</small>{!chat.provider_available && chat.provider_id && <span className="warning-dot" title={t('providerRequired')} />}</button>)}
      </aside>

      <section className="conversation-panel">
        <div className="conversation-toolbar">
          <label><span>{t('selectProvider')}</span><select value={selectedProvider} onChange={(event) => { void changeProvider(event.target.value); }} disabled={providers.length === 0 || loading}><option value="">—</option>{providers.map((provider) => <option key={provider.id} value={provider.id} disabled={provider.validation_status !== 'verified'}>{provider.name} · {provider.protocol} · {provider.validation_status === 'verified' ? t('verified') : t('untested')}</option>)}</select></label>
          <label><span>{t('selectModel')}</span><input list="chat-provider-models" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} onBlur={() => { if (selectedModel.trim()) void changeModel(selectedModel.trim()); }} disabled={!selectedProvider || modelsLoading || loading} placeholder={modelsLoading ? (language === 'ar' ? 'جارٍ التحميل…' : 'Loading…') : (language === 'ar' ? 'Model ID فعلي' : 'Actual model ID')} /><datalist id="chat-provider-models">{modelOptions.map((model) => <option value={model} key={model} />)}</datalist></label>
          <label><span>{t('chatMode')}</span><select value={mode} disabled={loading} onChange={(event) => { const next = event.target.value as ChatMode; setMode(next); if (current) void updateConversation({ mode: next }); }}><option value="agent">{t('agentMode')}</option><option value="chat">{t('simpleChat')}</option><option value="multi-agent" disabled={verifiedProviders.length < 2}>{language === 'ar' ? `وكلاء متعددون (${verifiedProviders.length})` : `Multi-agent (${verifiedProviders.length})`}</option></select></label>
          {loading ? <button type="button" className="danger ghost compact" onClick={cancelRequest}>{language === 'ar' ? 'إلغاء' : 'Cancel'}</button> : current && <button type="button" className="danger ghost compact" onClick={() => { void deleteChat(); }}>{t('delete')}</button>}
        </div>

        <div className="messages" ref={messagesRef}>
          {!current && <EmptyState title={providers.length === 0 ? t('noProviders') : t('noChats')} description={providers.length === 0 ? t('providerRequired') : undefined} action={providers.length === 0 ? <button type="button" onClick={() => onNavigate('providers')}>{t('providers')}</button> : <button type="button" onClick={() => { void createChat(); }}>{t('newChat')}</button>} />}
          {messages.map((message) => <article key={message.id} className={`msg ${message.role} ${message.status ?? ''}`}><div className="message-role">{message.role === 'user' ? (language === 'ar' ? 'أنت' : 'You') : 'Moataz AI'}{message.status === 'partial' && <small>{language === 'ar' ? 'رد جزئي' : 'Partial response'}</small>}{message.status === 'failed' && <small>{language === 'ar' ? 'فشل' : 'Failed'}</small>}</div><pre>{message.content}</pre><AttachmentList attachments={message.attachments ?? []} /><ToolTimeline calls={Array.isArray(message.tool_calls) ? message.tool_calls : []} /></article>)}
          {loading && requestStage !== 'receiving' && <div className="typing" aria-label={t('loading')}><span /><span /><span /></div>}
        </div>
        {current && <div className="composer-shell">
          <AttachmentList attachments={pendingAttachments} onRemove={(id) => { void removePendingAttachment(id); }} />
          <div className="composer">
            <input ref={fileInputRef} className="visually-hidden" type="file" multiple accept="image/*,.txt,.md,.json,.jsonl,.csv,.xml,.yaml,.yml,.toml,.js,.ts,.tsx,.jsx,.css,.html,.py,.java,.kt,.go,.rs,.php,.rb,.sh,.sql,.zip,application/zip" onChange={(event) => { void uploadFiles(event.target.files); }} />
            <button type="button" className="icon-button attach-button" title={language === 'ar' ? 'إضافة ملفات أو صور' : 'Add files or images'} onClick={() => fileInputRef.current?.click()} disabled={uploading || loading || pendingAttachments.length >= MAX_ATTACHMENTS}>{uploading ? '…' : '＋'}</button>
            <textarea rows={2} placeholder={language === 'ar' ? 'اكتب رسالة، أو أرفق ملفات وصورًا…' : 'Write a message, or attach files and images…'} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} />
            <button type="button" onClick={() => { void send(); }} disabled={(!input.trim() && pendingAttachments.length === 0) || loading || uploading || !selectedProvider || !providerReady || !modelReady}><SpinnerLabel active={loading} activeText={stageText(requestStage, language) || (language === 'ar' ? 'جارٍ التنفيذ…' : 'Running…')} idleText={t('send')} /></button>
          </div>
          <small className="composer-hint">{language === 'ar' ? `المزوّد: ${selectedProviderRecord?.name ?? '—'} · النموذج: ${selectedModel || '—'} · ${mode === 'chat' && selectedProviderRecord?.streaming_enabled !== false ? 'Streaming' : 'Buffered'}` : `Provider: ${selectedProviderRecord?.name ?? '—'} · Model: ${selectedModel || '—'} · ${mode === 'chat' && selectedProviderRecord?.streaming_enabled !== false ? 'Streaming' : 'Buffered'}`}</small>
        </div>}
      </section>
    </div>
  </div>;
}
