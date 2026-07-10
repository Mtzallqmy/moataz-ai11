import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState, Notice, PageHeader } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { SystemStatus } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;

export function HomePage({ request, t, language, onNavigate }: { request: Request; t: T; language: Language; onNavigate: (page: 'providers' | 'chat' | 'integrations') => void }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStatus(await request<SystemStatus>('/api/system/status'));
    } catch (caught) {
      setError(formatError(caught, language));
    } finally {
      setLoading(false);
    }
  }, [language, request]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Moataz AI" title={t('welcome')} description={t('hero')} actions={<button type="button" onClick={() => onNavigate('chat')}>{t('newChat')}</button>} />
      {error && <Notice tone="error" onDismiss={() => setError('')}><pre>{error}</pre></Notice>}
      <section className="stats-grid" aria-busy={loading}>
        <article className="stat-card"><span>{t('database')}</span><strong>{status?.database === 'ready' ? t('available') : t('unavailable')}</strong><small>{status?.version ?? '—'}</small></article>
        <article className="stat-card"><span>{t('configuredProviders')}</span><strong>{status?.providerCount ?? '—'}</strong><button type="button" className="text-button" onClick={() => onNavigate('providers')}>{t('providers')} ←</button></article>
        <article className="stat-card"><span>{t('telegramBots')}</span><strong>{status?.telegram.botCount ?? '—'}</strong><button type="button" className="text-button" onClick={() => onNavigate('integrations')}>{t('integrations')} ←</button></article>
        <article className="stat-card"><span>{t('uptime')}</span><strong>{status ? `${Math.floor(status.uptimeSeconds / 60)}m` : '—'}</strong><small>{status?.terminal.enabled ? t('available') : t('unavailable')}</small></article>
      </section>
      {!loading && status && status.providerCount === 0 && (
        <EmptyState title={t('noProviders')} description={t('providerRequired')} action={<button type="button" onClick={() => onNavigate('providers')}>{t('addProvider')}</button>} />
      )}
    </div>
  );
}
