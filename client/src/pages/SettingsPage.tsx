import React, { useCallback, useEffect, useState } from 'react';
import { Notice, PageHeader, StatusBadge } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { SystemStatus } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;

export function SettingsPage({ request, t, language, setLanguage, theme, setTheme }: { request: Request; t: T; language: Language; setLanguage: (language: Language) => void; theme: string; setTheme: (theme: string) => void }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setStatus(await request<SystemStatus>('/api/system/status')); }
    catch (caught) { setError(formatError(caught, language)); }
  }, [language, request]);

  useEffect(() => { void load(); }, [load]);

  return <div className="page-stack">
    <PageHeader title={t('settings')} description={language === 'ar' ? 'المظهر واللغة وحالة قاعدة البيانات والمزوّدات وTelegram وSandbox.' : 'Appearance, language, database, providers, Telegram, and sandbox runtime status.'} />
    {error && <Notice tone="error"><pre>{error}</pre></Notice>}
    <div className="settings-grid">
      <section className="panel">
        <div className="section-heading"><div><h2>{t('appearance')}</h2><p>{language === 'ar' ? 'تُحفظ هذه الخيارات على جهازك.' : 'These preferences are stored on this device.'}</p></div></div>
        <div className="form-grid one-column">
          <label><span>{t('language')}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)}><option value="ar">العربية</option><option value="en">English</option></select></label>
          <label><span>{t('theme')}</span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="dark">{t('dark')}</option><option value="light">{t('light')}</option></select></label>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading"><div><h2>{t('systemHealth')}</h2><p>{status?.version ?? '—'}</p></div><button type="button" className="ghost" onClick={() => { void load(); }}>{t('refresh')}</button></div>
        <dl className="definition-list">
          <dt>{t('database')}</dt><dd><StatusBadge status={status?.database === 'ready' ? 'verified' : 'failed'} t={t} /></dd>
          <dt>{t('configuredProviders')}</dt><dd>{status?.providerCount ?? '—'}</dd>
          <dt>{t('telegramBots')}</dt><dd>{status ? `${status.telegram.botCount} / ${status.telegram.configuredCount}` : '—'}{status && status.telegram.discoveryOnlyCount > 0 ? ` (${language === 'ar' ? 'اكتشاف' : 'discovery'}: ${status.telegram.discoveryOnlyCount})` : ''}</dd>
          <dt>Sandbox</dt><dd>{status?.shell.externalConfigured ? (language === 'ar' ? 'خارجي متحقق منه' : 'Verified external') : (language === 'ar' ? 'غير مضاف' : 'Not configured')}</dd>
          <dt>{t('terminal')}</dt><dd>{status?.shell.enabled ? t('available') : t('unavailable')}</dd>
          <dt>{t('uptime')}</dt><dd>{status ? `${Math.floor(status.uptimeSeconds / 60)} min` : '—'}</dd>
        </dl>
      </section>
    </div>
  </div>;
}
