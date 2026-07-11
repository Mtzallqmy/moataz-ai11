import React, { useEffect, useRef, useState } from 'react';
import { Notice, PageHeader, SpinnerLabel } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { SystemStatus } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type TerminalEvent = { type: 'session_started'; userId: string } | { type: 'output'; stream: 'stdout' | 'stderr'; data: string } | { type: 'process_exit'; code: number | null; signal: string | null } | { type: 'error'; code: string };
type Mode = 'loading' | 'external' | 'websocket' | 'unavailable';

export function TerminalPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [mode, setMode] = useState<Mode>('loading');
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
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
          setOutput(language === 'ar' ? '[Sandbox خارجي جاهز. كل أمر يُنفّذ بطلب مستقل ومع تأكيد صريح.]\n' : '[External sandbox ready. Each command runs as a separate explicitly confirmed request.]\n');
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
        if (!cancelled) {
          setMode('unavailable');
          setError(formatError(caught, language));
        }
      }
    })();
    return () => { cancelled = true; socketRef.current?.close(1000, 'page_closed'); };
  }, [language, request]);

  useEffect(() => { if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight; }, [output]);

  const send = async () => {
    const value = command.trim();
    if (!value || running) return;
    if (mode === 'websocket') {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data: `${value}\n` }));
        setCommand('');
      }
      return;
    }
    if (mode !== 'external') return;
    setRunning(true);
    setError('');
    setOutput((previous) => `${previous}\n$ ${value}\n`);
    setCommand('');
    try {
      const response = await request<{ result: unknown }>('/api/tools/run', {
        method: 'POST',
        body: JSON.stringify({ name: 'shell', args: { command: value }, confirmation: { confirmed: true } })
      });
      const result = response.result !== null && typeof response.result === 'object' && 'output' in response.result
        ? (response.result as { output: unknown }).output
        : response.result;
      setOutput((previous) => `${previous}${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}\n`);
    } catch (caught) {
      const message = formatError(caught, language);
      setError(message);
      setOutput((previous) => `${previous}[error] ${message}\n`);
    } finally {
      setRunning(false);
    }
  };

  return <div className="page-stack"><PageHeader title={t('terminal')} description={language === 'ar' ? 'في الإنتاج تُرسل الأوامر إلى Sandbox خارجي موثّق؛ لا يتم تشغيل Shell داخل حاوية Railway.' : 'In production commands are sent to a configured external sandbox; shell never runs inside the Railway container.'} />{error && <Notice tone="error"><pre>{error}</pre></Notice>}{mode === 'unavailable' && <Notice tone="warning">{language === 'ar' ? 'أضف تكامل External Sandbox واختبره أولًا. يجب أن يوفر GET /health وPOST /v1/execute.' : 'Configure and verify an External Sandbox integration first. It must expose GET /health and POST /v1/execute.'}</Notice>}{mode === 'loading' && <Notice>{t('loading')}</Notice>}{(mode === 'external' || mode === 'websocket') && <section className="panel"><pre className="term" ref={terminalRef}>{output}</pre><div className="terminal-input"><input aria-label="Terminal input" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void send(); } }} /><button type="button" onClick={() => { void send(); }} disabled={!command.trim() || running}><SpinnerLabel active={running} activeText={language === 'ar' ? 'جارٍ التنفيذ…' : 'Running…'} idleText={t('send')} /></button></div></section>}</div>;
}
