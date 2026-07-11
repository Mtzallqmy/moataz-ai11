import React, { useEffect, useRef, useState } from 'react';
import { Notice, PageHeader, SpinnerLabel } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { SystemStatus } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type TerminalEvent = { type: 'session_started'; userId: string } | { type: 'output'; stream: 'stdout' | 'stderr'; data: string } | { type: 'process_exit'; code: number | null; signal: string | null } | { type: 'error'; code: string };
type Mode = 'loading' | 'external' | 'websocket' | 'unavailable';
type Tab = 'api' | 'shell';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function parseJsonObject(raw: string, field: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const value = JSON.parse(raw) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be a JSON object.`);
  return value as Record<string, unknown>;
}

export function TerminalPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [tab, setTab] = useState<Tab>('api');
  const [mode, setMode] = useState<Mode>('loading');
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('moataz_api_url') ?? '');
  const [apiMethod, setApiMethod] = useState<HttpMethod>('POST');
  const [apiHeaders, setApiHeaders] = useState('{\n  "Accept": "application/json"\n}');
  const [apiBody, setApiBody] = useState('{\n  "prompt": ""\n}');
  const [apiPrompt, setApiPrompt] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const system = await request<SystemStatus>('/api/system/status');
        if (cancelled) return;
        if (system.shell.externalConfigured || system.shell.sandboxMode === 'external') {
          setMode('external');
          setOutput(language === 'ar' ? '[Sandbox خارجي جاهز. كل أمر يحتاج تنفيذًا صريحًا.]\n' : '[External sandbox ready. Each command requires explicit execution.]\n');
          return;
        }
        if (!system.terminal.enabled || !system.shell.enabled) {
          setMode('unavailable');
          return;
        }
        setMode('websocket');
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
      } catch (caught) {
        if (!cancelled) { setMode('unavailable'); setError(formatError(caught, language)); }
      }
    })();
    return () => { cancelled = true; socketRef.current?.close(1000, 'page_closed'); };
  }, [language, request]);

  useEffect(() => { if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight; }, [output]);
  useEffect(() => { localStorage.setItem('moataz_api_url', apiUrl); }, [apiUrl]);

  const sendShell = async () => {
    const value = command.trim();
    if (!value || running) return;
    if (mode === 'websocket') {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'input', data: `${value}\n` })); setCommand(''); }
      return;
    }
    if (mode !== 'external') return;
    setRunning(true); setError(''); setOutput((previous) => `${previous}\n$ ${value}\n`); setCommand('');
    try {
      const response = await request<{ result: unknown }>('/api/tools/run', {
        method: 'POST', body: JSON.stringify({ name: 'shell', args: { command: value }, confirmation: { confirmed: true } })
      });
      const result = response.result !== null && typeof response.result === 'object' && 'output' in response.result ? (response.result as { output: unknown }).output : response.result;
      setOutput((previous) => `${previous}${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}\n`);
    } catch (caught) {
      const message = formatError(caught, language); setError(message); setOutput((previous) => `${previous}[error] ${message}\n`);
    } finally { setRunning(false); }
  };

  const runApi = async () => {
    if (!apiUrl.trim() || running) return;
    if (!window.confirm(language === 'ar' ? `إرسال طلب ${apiMethod} إلى هذا الـAPI؟\n${apiUrl}` : `Send a ${apiMethod} request to this API?\n${apiUrl}`)) return;
    setRunning(true); setError('');
    try {
      const headers = parseJsonObject(apiHeaders, 'Headers');
      let body: unknown = undefined;
      if (apiMethod !== 'GET') {
        body = apiBody.trim() ? JSON.parse(apiBody) as unknown : {};
        if (apiPrompt.trim()) {
          const record = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
          body = { ...record, prompt: apiPrompt.trim() };
        }
      }
      const response = await request<{ result: unknown }>('/api/tools/run', {
        method: 'POST',
        body: JSON.stringify({
          name: 'http_request',
          args: { url: apiUrl.trim(), method: apiMethod, headers, ...(body !== undefined ? { body } : {}) },
          confirmation: { confirmed: true }
        })
      });
      setOutput(JSON.stringify(response.result, null, 2));
      setTab('api');
    } catch (caught) {
      const message = caught instanceof SyntaxError
        ? (language === 'ar' ? `JSON غير صالح: ${caught.message}` : `Invalid JSON: ${caught.message}`)
        : formatError(caught, language);
      setError(message); setOutput(`[error]\n${message}`);
    } finally { setRunning(false); }
  };

  return <div className="page-stack terminal-page">
    <PageHeader title={t('terminal')} description={language === 'ar' ? 'وحدة API آمنة تعمل دون Sandbox، وطرفية أوامر تعمل فقط داخل Sandbox خارجي معزول. لا تُشغّل أوامر داخل حاوية Railway.' : 'A safe API console works without a sandbox. Shell commands only run in an isolated external sandbox, never inside Railway.'} />
    {error && <Notice tone="error" onDismiss={() => setError('')}><pre>{error}</pre></Notice>}
    <div className="terminal-tabs"><button type="button" className={tab === 'api' ? 'active' : 'ghost'} onClick={() => setTab('api')}>{language === 'ar' ? 'وحدة API' : 'API console'}</button><button type="button" className={tab === 'shell' ? 'active' : 'ghost'} onClick={() => setTab('shell')}>{language === 'ar' ? 'طرفية Sandbox' : 'Sandbox shell'}</button></div>

    {tab === 'api' && <section className="panel api-console">
      <div className="section-heading"><div><h2>{language === 'ar' ? 'تشغيل أي API عام' : 'Run a public API'}</h2><p>{language === 'ar' ? 'ألصق الرابط وحدد الطريقة والرؤوس وBody. يمكن كتابة البرومبت منفصلًا وسيُرسل في حقل prompt. يتم حجب الشبكات الخاصة والروابط الداخلية تلقائيًا.' : 'Paste the URL, method, headers, and body. A separate prompt is injected into the prompt field. Private and internal networks are blocked.'}</p></div></div>
      <div className="form-grid api-form">
        <label className="span-2"><span>URL</span><input inputMode="url" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder="https://api.example.com/v1/run" /></label>
        <label><span>{language === 'ar' ? 'الطريقة' : 'Method'}</span><select value={apiMethod} onChange={(event) => setApiMethod(event.target.value as HttpMethod)}><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
        <label><span>{language === 'ar' ? 'البرومبت' : 'Prompt'}</span><input value={apiPrompt} onChange={(event) => setApiPrompt(event.target.value)} placeholder={language === 'ar' ? 'اختياري — يضاف إلى body.prompt' : 'Optional — added to body.prompt'} /></label>
        <label><span>Headers JSON</span><textarea rows={7} value={apiHeaders} onChange={(event) => setApiHeaders(event.target.value)} spellCheck={false} /></label>
        <label><span>Body JSON</span><textarea rows={7} value={apiBody} onChange={(event) => setApiBody(event.target.value)} spellCheck={false} disabled={apiMethod === 'GET'} /></label>
        <div className="form-actions span-2"><button type="button" onClick={() => { void runApi(); }} disabled={!apiUrl.trim() || running}><SpinnerLabel active={running} activeText={language === 'ar' ? 'جارٍ الاتصال…' : 'Calling…'} idleText={language === 'ar' ? 'تأكيد وتشغيل API' : 'Confirm & run API'} /></button></div>
      </div>
      <pre className="term api-output" ref={terminalRef}>{output || (language === 'ar' ? '[ستظهر الاستجابة هنا]' : '[Response appears here]')}</pre>
    </section>}

    {tab === 'shell' && <>
      {mode === 'unavailable' && <Notice tone="warning"><div><strong>{language === 'ar' ? 'Sandbox غير متصل' : 'Sandbox is not connected'}</strong><p>{language === 'ar' ? 'أضف تكامل External Sandbox واختبره. يجب أن يوفر GET /health وPOST /v1/execute. وحدة API أعلاه تعمل دون Sandbox.' : 'Configure and verify an External Sandbox with GET /health and POST /v1/execute. The API console above works without it.'}</p></div></Notice>}
      {mode === 'loading' && <Notice>{t('loading')}</Notice>}
      {(mode === 'external' || mode === 'websocket') && <section className="panel"><pre className="term" ref={terminalRef}>{output}</pre><div className="terminal-input"><input aria-label="Terminal input" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void sendShell(); } }} /><button type="button" onClick={() => { void sendShell(); }} disabled={!command.trim() || running}><SpinnerLabel active={running} activeText={language === 'ar' ? 'جارٍ التنفيذ…' : 'Running…'} idleText={t('send')} /></button></div></section>}
    </>}
  </div>;
}
