import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { useT, type Language, type TranslationKey } from './lib/i18n';
import { reconcileMessageResponse, type ChatMessage, type ToolCall } from './chat/message-state';
import './styles/app.css';

type T = (key: TranslationKey) => string;
type ProviderSummary = { id: string; name: string; type: string; default_model: string; base_url?: string | null };
type IntegrationSummary = { id: string; name: string; type: string };
type ChatSummary = { id: string; title: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const { status, logout } = useAuth();
  const [lang, setLang] = useState<Language>((localStorage.getItem('moataz_lang') as Language | null) ?? 'ar');
  const [theme, setTheme] = useState(localStorage.getItem('moataz_theme') ?? 'dark');
  const t = useT(lang);

  useEffect(() => {
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('moataz_lang', lang);
    localStorage.setItem('moataz_theme', theme);
  }, [lang, theme]);

  if (status === 'loading') return <div className="login"><div className="card glass"><p>{t('loading')}</p></div></div>;
  if (status === 'unauthenticated') return <Login t={t} />;
  return <Dashboard t={t} lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} onLogout={() => { void logout(); }} />;
}

function Login({ t }: { t: T }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login({ email, password });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="card glass">
        <div className="brand" style={{ justifyContent: 'center' }}><div className="logo">M</div><h2>Moataz AI</h2></div>
        <h3 style={{ textAlign: 'center' }}>{t('login')}</h3>
        {error && <p className="err" role="alert">{error}</p>}
        <form onSubmit={submit} className="form" style={{ gridTemplateColumns: '1fr' }}>
          <label>{t('email')}<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>{t('password')}<input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button type="submit" disabled={loading}>{loading ? '…' : t('login')}</button>
        </form>
      </div>
    </div>
  );
}

type Page = 'home' | 'chat' | 'providers' | 'integrations' | 'terminal' | 'settings';
function Dashboard({ t, lang, setLang, theme, setTheme, onLogout }: { t: T; lang: Language; setLang: (value: Language) => void; theme: string; setTheme: (value: string) => void; onLogout: () => void }) {
  const [page, setPage] = useState<Page>('home');
  const nav: Array<[Page, TranslationKey]> = [['home', 'dashboard'], ['chat', 'chat'], ['providers', 'providers'], ['integrations', 'integrations'], ['terminal', 'terminal'], ['settings', 'settings']];
  return (
    <main>
      <aside aria-label="Main navigation">
        <div className="brand small"><div className="logo">M</div><strong>Moataz AI</strong></div>
        {nav.map(([value, label]) => <button key={value} className={page === value ? 'active' : ''} onClick={() => setPage(value)}>{t(label)}</button>)}
        <div style={{ marginTop: 'auto' }}><button className="ghost" onClick={onLogout} style={{ width: '100%' }}>{t('logout')}</button></div>
      </aside>
      <div className="content">
        {page === 'home' && <Home t={t} />}
        {page === 'chat' && <ChatPage t={t} />}
        {page === 'providers' && <ProvidersPage t={t} />}
        {page === 'integrations' && <IntegrationsPage t={t} />}
        {page === 'terminal' && <TerminalPage t={t} />}
        {page === 'settings' && <SettingsPage t={t} lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} />}
      </div>
    </main>
  );
}

function Home({ t }: { t: T }) {
  return <div className="grid"><div className="hero"><h1>{t('welcome')}</h1><p>{t('hero')}</p></div></div>;
}

function ProvidersPage({ t }: { t: T }) {
  const { request } = useAuth();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [form, setForm] = useState({ name: '', type: 'openai', defaultModel: '', baseUrl: '', apiKey: '' });
  const [error, setError] = useState('');
  const load = async () => {
    try { setProviders((await request<{ providers: ProviderSummary[] }>('/api/providers')).providers); }
    catch (caught) { setError(errorText(caught)); }
  };
  useEffect(() => { void load(); }, []);
  const add = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      await request('/api/providers', { method: 'POST', body: JSON.stringify({ ...form, ...(form.baseUrl ? {} : { baseUrl: undefined }) }) });
      setForm({ name: '', type: 'openai', defaultModel: '', baseUrl: '', apiKey: '' });
      await load();
    } catch (caught) { setError(errorText(caught)); }
  };
  const remove = async (id: string) => { try { await request(`/api/providers/${id}`, { method: 'DELETE' }); await load(); } catch (caught) { setError(errorText(caught)); } };
  return (
    <section className="tile"><h2>{t('providers')}</h2>{error && <p className="err" role="alert">{error}</p>}
      <form onSubmit={add} className="form">
        <input aria-label={t('name')} placeholder={t('name')} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        <select aria-label={t('type')} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
          {['openai', 'openrouter', 'anthropic', 'gemini', 'groq', 'together', 'deepseek', 'mistral'].map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input aria-label={t('model')} placeholder={t('model')} value={form.defaultModel} onChange={(event) => setForm({ ...form, defaultModel: event.target.value })} required />
        <input aria-label={t('baseUrl')} placeholder={t('baseUrl')} value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
        <input aria-label={t('apiKey')} type="password" autoComplete="off" placeholder={t('apiKey')} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} required />
        <button type="submit" style={{ gridColumn: '1 / -1' }}>{t('addProvider')}</button>
      </form>
      <div className="list">{providers.map((provider) => <div key={provider.id} className="row"><div><strong>{provider.name}</strong> – {provider.type} – {provider.default_model}</div><button className="ghost" aria-label="Delete provider" onClick={() => { void remove(provider.id); }}>×</button></div>)}</div>
    </section>
  );
}

function IntegrationsPage({ t }: { t: T }) {
  const { request } = useAuth();
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [form, setForm] = useState({ type: 'github', name: '', token: '' });
  const [error, setError] = useState('');
  const load = async () => { try { setIntegrations((await request<{ integrations: IntegrationSummary[] }>('/api/integrations')).integrations); } catch (caught) { setError(errorText(caught)); } };
  useEffect(() => { void load(); }, []);
  const add = async (event: React.FormEvent) => { event.preventDefault(); try { await request('/api/integrations', { method: 'POST', body: JSON.stringify(form) }); setForm({ type: 'github', name: '', token: '' }); await load(); } catch (caught) { setError(errorText(caught)); } };
  const remove = async (id: string) => { try { await request(`/api/integrations/${id}`, { method: 'DELETE' }); await load(); } catch (caught) { setError(errorText(caught)); } };
  return (
    <section className="tile"><h2>{t('integrations')}</h2>{error && <p className="err" role="alert">{error}</p>}
      <form onSubmit={add} className="form"><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="github">GitHub</option><option value="telegram">Telegram</option></select><input placeholder={t('name')} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /><input type="password" autoComplete="off" placeholder="Token" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} required /><button type="submit" style={{ gridColumn: '1 / -1' }}>{t('addIntegration')}</button></form>
      <div className="list">{integrations.map((integration) => <div key={integration.id} className="row"><div><strong>{integration.name}</strong> – {integration.type}</div><button className="ghost" aria-label="Delete integration" onClick={() => { void remove(integration.id); }}>×</button></div>)}</div>
    </section>
  );
}

function ToolTimeline({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null;
  return <div className="tool-timeline">{calls.map((call) => {
    const duration = call.startedAt && call.finishedAt ? Math.max(0, Date.parse(call.finishedAt) - Date.parse(call.startedAt)) : undefined;
    return <div key={call.id} className="tool-card"><strong>{call.name}</strong> <span>{call.status}</span>{duration !== undefined && <small>{duration} ms</small>}<pre>{JSON.stringify(call.arguments, null, 2)}</pre>{call.result !== undefined && <pre>{JSON.stringify(call.result, null, 2)}</pre>}{call.error && <p className="err">{call.error.code}: {call.error.message}</p>}</div>;
  })}</div>;
}

function ChatPage({ t }: { t: T }) {
  const { request } = useAuth();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const loadChats = async () => { try { setChats((await request<{ chats: ChatSummary[] }>('/api/chats')).chats); } catch (caught) { setError(errorText(caught)); } };
  const loadMessages = async (id: string) => { try { setMessages((await request<{ messages: ChatMessage[] }>(`/api/chats/${id}/messages`)).messages); } catch (caught) { setError(errorText(caught)); } };
  useEffect(() => { void loadChats(); }, []);
  useEffect(() => { if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; }, [messages]);
  const createChat = async () => { try { const response = await request<{ id: string }>('/api/chats', { method: 'POST', body: '{}' }); await loadChats(); setCurrent(response.id); setMessages([]); } catch (caught) { setError(errorText(caught)); } };
  const send = async () => {
    if (!current || !input.trim() || loading) return;
    const content = input.trim();
    const temporaryId = `temp-${crypto.randomUUID()}`;
    const key = crypto.randomUUID();
    setInput(''); setError(''); setLoading(true);
    setMessages((previous) => [...previous, { id: temporaryId, role: 'user', content, tool_calls: [] }]);
    try {
      const response = await request<{ userMessage?: ChatMessage; message: ChatMessage }>(`/api/chats/${current}/messages`, {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ content })
      });
      setMessages((previous) => reconcileMessageResponse(previous, temporaryId, response.userMessage, response.message));
      await loadChats();
    } catch (caught) {
      setMessages((previous) => previous.filter((message) => message.id !== temporaryId));
      setError(errorText(caught));
    } finally { setLoading(false); }
  };
  return (
    <div className="chat"><div className="chats"><button className="ghost" onClick={() => { void createChat(); }}>{t('newChat')}</button>{chats.map((chat) => <button key={chat.id} className={current === chat.id ? 'active' : 'ghost'} onClick={() => { setCurrent(chat.id); void loadMessages(chat.id); }}>{chat.title || 'Chat'}</button>)}</div>
      <div className="messages" ref={messagesRef}>{error && <p className="err" role="alert">{error}</p>}{current === null && <p>{t('newChat')}</p>}{messages.map((message) => <div key={message.id} className={`msg ${message.role}`}><pre>{message.content}</pre><ToolTimeline calls={Array.isArray(message.tool_calls) ? message.tool_calls : []} /></div>)}{loading && <p>…</p>}{current && <div className="composer"><textarea placeholder={t('message')} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} /><button onClick={() => { void send(); }} disabled={!input.trim() || loading}>{t('send')}</button></div>}</div>
    </div>
  );
}

type TerminalEvent = { type: 'session_started'; userId: string } | { type: 'output'; stream: 'stdout' | 'stderr'; data: string } | { type: 'process_exit'; code: number | null; signal: string | null } | { type: 'error'; code: string };
function TerminalPage({ t }: { t: T }) {
  const { request } = useAuth();
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await request<{ ticket: string }>('/api/auth/ws-ticket', { method: 'POST', body: '{}' });
        if (cancelled) return;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal?ticket=${encodeURIComponent(response.ticket)}`);
        socketRef.current = socket;
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as TerminalEvent;
            if (message.type === 'output') setOutput((previous) => previous + message.data);
            else if (message.type === 'error') setOutput((previous) => `${previous}\n[${message.code}]`);
            else if (message.type === 'process_exit') setOutput((previous) => `${previous}\n[process exited: ${message.code ?? message.signal ?? 'unknown'}]`);
          } catch { setOutput((previous) => `${previous}\n[invalid server event]`); }
        };
        socket.onclose = (event) => setOutput((previous) => `${previous}\n[Disconnected: ${event.reason || event.code}]`);
      } catch (caught) { setOutput(`[${errorText(caught)}]`); }
    })();
    return () => { cancelled = true; socketRef.current?.close(1000, 'page_closed'); };
  }, [request]);
  useEffect(() => { if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight; }, [output]);
  const send = () => { const socket = socketRef.current; if (socket?.readyState === WebSocket.OPEN && command.trim()) { socket.send(JSON.stringify({ type: 'input', data: `${command}\n` })); setCommand(''); } };
  return <section className="tile"><h2>{t('terminal')}</h2><pre className="term" ref={terminalRef}>{output}</pre><div className="terminal-input"><input aria-label="Terminal input" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); send(); } }} /><button onClick={send} disabled={!command.trim()}>Send</button></div></section>;
}

function SettingsPage({ t, lang, setLang, theme, setTheme }: { t: T; lang: Language; setLang: (value: Language) => void; theme: string; setTheme: (value: string) => void }) {
  return <section className="tile"><h2>{t('settings')}</h2><div className="form" style={{ gridTemplateColumns: '1fr' }}><label>{t('language')}<select value={lang} onChange={(event) => setLang(event.target.value as Language)}><option value="ar">العربية</option><option value="en">English</option></select></label><label>{t('theme')}<select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="dark">{t('dark')}</option><option value="light">{t('light')}</option></select></label></div></section>;
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<AuthProvider><App /></AuthProvider>);
