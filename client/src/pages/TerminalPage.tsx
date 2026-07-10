import React, { useEffect, useRef, useState } from 'react';
import { Notice, PageHeader } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { SystemStatus } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type TerminalEvent = { type: 'session_started'; userId: string } | { type: 'output'; stream: 'stdout' | 'stderr'; data: string } | { type: 'process_exit'; code: number | null; signal: string | null } | { type: 'error'; code: string };

export function TerminalPage({ request, t, language }: { request: Request; t: T; language: Language }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const system = await request<SystemStatus>('/api/system/status');
        if (cancelled) return;
        setAvailable(system.terminal.enabled && system.shell.enabled);
        if (!system.terminal.enabled || !system.shell.enabled) return;
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
        if (!cancelled) setError(formatError(caught, language));
      }
    })();
    return () => { cancelled = true; socketRef.current?.close(1000, 'page_closed'); };
  }, [language, request]);

  useEffect(() => { if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight; }, [output]);

  const send = () => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN && command.trim()) {
      socket.send(JSON.stringify({ type: 'input', data: `${command}\n` }));
      setCommand('');
    }
  };

  return <div className="page-stack"><PageHeader title={t('terminal')} description={language === 'ar' ? 'تعمل الطرفية فقط عند ربط Sandbox خارجي معزول.' : 'The terminal is available only with an isolated external sandbox.'} />{error && <Notice tone="error"><pre>{error}</pre></Notice>}{available === false && <Notice tone="warning">{t('terminalDisabled')}</Notice>}{available === null && <Notice>{t('loading')}</Notice>}{available && <section className="panel"><pre className="term" ref={terminalRef}>{output}</pre><div className="terminal-input"><input aria-label="Terminal input" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); send(); } }} /><button type="button" onClick={send} disabled={!command.trim()}>{t('send')}</button></div></section>}</div>;
}
