import React, { useCallback, useEffect, useState } from 'react';
import { Notice, PageHeader, SpinnerLabel, StatusBadge } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { AuthSession, SystemStatus } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;

function deviceLabel(userAgent: string | null | undefined, language: Language): string {
  if (!userAgent) return language === 'ar' ? 'جهاز غير معروف' : 'Unknown device';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const system = /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : /Macintosh/.test(userAgent) ? 'macOS' : '';
  return `${browser}${system ? ` · ${system}` : ''}`;
}

export function SettingsPage({ request, t, language, setLanguage, theme, setTheme }: { request: Request; t: T; language: Language; setLanguage: (language: Language) => void; theme: string; setTheme: (theme: string) => void }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [system, sessionResponse] = await Promise.all([
        request<SystemStatus>('/api/system/status'),
        request<{ sessions: AuthSession[] }>('/api/auth/sessions')
      ]);
      setStatus(system);
      setSessions(sessionResponse.sessions);
    } catch (caught) { setError(formatError(caught, language)); }
  }, [language, request]);

  useEffect(() => { void load(); }, [load]);

  const revoke = async (session: AuthSession) => {
    if (session.current) return;
    if (!window.confirm(language === 'ar' ? 'إنهاء هذه الجلسة على الجهاز الآخر؟' : 'End this session on the other device?')) return;
    setBusy(session.id); setError(''); setNotice('');
    try {
      await request(`/api/auth/sessions/${session.id}`, { method: 'DELETE' });
      setNotice(language === 'ar' ? 'تم إنهاء الجلسة المحددة.' : 'The selected session was ended.');
      await load();
    } catch (caught) { setError(formatError(caught, language)); }
    finally { setBusy(null); }
  };

  const revokeOthers = async () => {
    if (!window.confirm(language === 'ar' ? 'إنهاء جميع الجلسات الأخرى مع إبقاء هذا الجهاز؟' : 'End every other session and keep this device signed in?')) return;
    setBusy('others'); setError(''); setNotice('');
    try {
      await request('/api/auth/sessions/others', { method: 'DELETE' });
      setNotice(language === 'ar' ? 'تم إنهاء جميع الجلسات الأخرى.' : 'All other sessions were ended.');
      await load();
    } catch (caught) { setError(formatError(caught, language)); }
    finally { setBusy(null); }
  };

  return <div className="page-stack settings-page">
    <PageHeader title={t('settings')} description={language === 'ar' ? 'المظهر واللغة وحالة المنصة والجلسات المحفوظة. لا يتم تسجيل الخروج بسبب خطأ مزوّد أو انقطاع مؤقت.' : 'Appearance, platform health, and persistent sessions. Provider or transient network errors never sign you out.'} />
    {error && <Notice tone="error" onDismiss={() => setError('')}><pre>{error}</pre></Notice>}
    {notice && <Notice tone="success" onDismiss={() => setNotice('')}>{notice}</Notice>}
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
          <dt>{t('configuredProviders')}</dt><dd>{status ? `${status.verifiedProviderCount ?? 0} / ${status.providerCount}` : '—'}</dd>
          <dt>{t('telegramBots')}</dt><dd>{status ? `${status.telegram.botCount} / ${status.telegram.configuredCount}` : '—'}{status && status.telegram.discoveryOnlyCount > 0 ? ` (${language === 'ar' ? 'اكتشاف' : 'discovery'}: ${status.telegram.discoveryOnlyCount})` : ''}</dd>
          <dt>Sandbox</dt><dd>{status?.shell.externalConfigured ? (language === 'ar' ? 'خارجي متحقق منه' : 'Verified external') : (language === 'ar' ? 'غير مضاف' : 'Not configured')}</dd>
          <dt>{t('terminal')}</dt><dd>{status?.terminal.enabled || status?.shell.externalConfigured ? t('available') : t('unavailable')}</dd>
          <dt>{t('uptime')}</dt><dd>{status ? `${Math.floor(status.uptimeSeconds / 60)} min` : '—'}</dd>
        </dl>
      </section>
    </div>

    <section className="panel sessions-panel">
      <div className="section-heading"><div><h2>{language === 'ar' ? 'الجلسات المحفوظة' : 'Saved sessions'}</h2><p>{language === 'ar' ? 'تبقى الجلسة فعالة حتى انتهاء مدتها أو إنهائها يدويًا. الجلسة الحالية لا تُحذف من هنا؛ استخدم تسجيل الخروج مع التأكيد.' : 'Sessions stay active until expiry or manual revocation. Use confirmed logout to end the current session.'}</p></div><button type="button" className="ghost" onClick={() => { void revokeOthers(); }} disabled={busy !== null || sessions.filter((session) => !session.current).length === 0}><SpinnerLabel active={busy === 'others'} activeText={language === 'ar' ? 'جارٍ الإنهاء…' : 'Ending…'} idleText={language === 'ar' ? 'إنهاء الجلسات الأخرى' : 'End other sessions'} /></button></div>
      <div className="session-list">{sessions.map((session) => <article className={`session-card ${session.current ? 'current' : ''}`} key={session.id}>
        <div><div className="resource-title"><strong>{deviceLabel(session.user_agent, language)}</strong>{session.current && <span className="status-badge verified">{language === 'ar' ? 'هذا الجهاز' : 'This device'}</span>}</div><small>{language === 'ar' ? 'بدأت:' : 'Started:'} {new Date(session.created_at).toLocaleString(language === 'ar' ? 'ar' : 'en')}</small><small>{language === 'ar' ? 'تنتهي:' : 'Expires:'} {new Date(session.expires_at).toLocaleString(language === 'ar' ? 'ar' : 'en')}</small></div>
        {!session.current && <button type="button" className="danger ghost compact" onClick={() => { void revoke(session); }} disabled={busy !== null}><SpinnerLabel active={busy === session.id} activeText={language === 'ar' ? 'جارٍ الإنهاء…' : 'Ending…'} idleText={language === 'ar' ? 'إنهاء' : 'End'} /></button>}
      </article>)}</div>
    </section>
  </div>;
}
