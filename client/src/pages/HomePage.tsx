import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState, Notice, PageHeader } from '../components/ui';
import { formatError } from '../lib/errors';
import type { Language, TranslationKey } from '../lib/i18n';
import type { CapabilityStatus, SystemStatus } from '../types';

type T = (key: TranslationKey) => string;
type Request = <R>(path: string, options?: RequestInit) => Promise<R>;
type TargetPage = 'providers' | 'chat' | 'integrations' | 'terminal' | 'settings';

type Capability = {
  key: keyof CapabilityStatus;
  icon: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  page: TargetPage;
};

const capabilities: Capability[] = [
  { key: 'chat', icon: '💬', titleAr: 'المحادثة', titleEn: 'Chat', descriptionAr: 'محادثات محفوظة مع اختيار المزود والنموذج.', descriptionEn: 'Saved conversations with provider and model selection.', page: 'chat' },
  { key: 'agent', icon: '🧠', titleAr: 'وضع الوكيل', titleEn: 'Agent mode', descriptionAr: 'حلقة أدوات فعلية وسجل تنفيذ داخل المحادثة.', descriptionEn: 'Real tool loop with execution history in chat.', page: 'chat' },
  { key: 'files', icon: '📁', titleAr: 'مساحة الملفات', titleEn: 'Workspace files', descriptionAr: 'قراءة وكتابة ونقل الملفات داخل مساحة معزولة للمستخدم.', descriptionEn: 'Read, write, and move files inside an isolated user workspace.', page: 'chat' },
  { key: 'webFetch', icon: '🔗', titleAr: 'قراءة صفحات الويب', titleEn: 'Web page fetch', descriptionAr: 'جلب النص من الروابط العامة مع حماية من SSRF.', descriptionEn: 'Fetch public pages with SSRF protection.', page: 'chat' },
  { key: 'webSearch', icon: '🌐', titleAr: 'البحث على الويب', titleEn: 'Web search', descriptionAr: 'بحث فعلي عبر Brave أو Tavily بعد ربط التكامل.', descriptionEn: 'Real search through a verified Brave or Tavily integration.', page: 'integrations' },
  { key: 'github', icon: '🐙', titleAr: 'GitHub', titleEn: 'GitHub', descriptionAr: 'قراءة المستودعات وتنفيذ العمليات المصرح بها.', descriptionEn: 'Read repositories and perform explicitly authorized actions.', page: 'integrations' },
  { key: 'telegram', icon: '✈️', titleAr: 'لوحة Telegram', titleEn: 'Telegram console', descriptionAr: 'أزرار وأوامر ومزوّدات وأدوات وتشخيص من داخل البوت.', descriptionEn: 'Buttons, commands, providers, tools, and diagnostics inside the bot.', page: 'integrations' },
  { key: 'sandbox', icon: '🧪', titleAr: 'Sandbox خارجي', titleEn: 'External sandbox', descriptionAr: 'تنفيذ الأوامر في خدمة مستقلة بدل حاوية Railway.', descriptionEn: 'Execute commands in a separate service instead of Railway.', page: 'integrations' },
  { key: 'terminal', icon: '›_', titleAr: 'الطرفية', titleEn: 'Terminal', descriptionAr: 'واجهة أوامر مرتبطة بالـSandbox الخارجي.', descriptionEn: 'Command interface backed by the external sandbox.', page: 'terminal' }
];

function fallbackCapabilities(status: SystemStatus): CapabilityStatus {
  const providerReady = (status.verifiedProviderCount ?? status.providerCount) > 0;
  return {
    chat: providerReady,
    agent: providerReady,
    files: true,
    webFetch: true,
    webSearch: false,
    github: false,
    telegram: status.telegram.enabled,
    sandbox: status.shell.externalConfigured === true,
    terminal: status.terminal.enabled
  };
}

export function HomePage({ request, t, language, onNavigate }: { request: Request; t: T; language: Language; onNavigate: (page: TargetPage) => void }) {
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
  const ready = status ? (status.capabilities ?? fallbackCapabilities(status)) : null;

  return (
    <div className="page-stack home-page">
      <PageHeader eyebrow="Moataz AI" title={t('welcome')} description={language === 'ar' ? 'كل الإمكانيات في مكان واحد: المحادثة، الوكيل، الملفات، الويب، GitHub، Telegram وSandbox. البطاقة الخضراء جاهزة الآن، والبطاقة الصفراء تحتاج إعدادًا.' : 'Every capability in one place: chat, agent, files, web, GitHub, Telegram, and sandbox. Green cards are ready now; amber cards require setup.'} actions={<div className="page-actions"><button type="button" className="ghost" onClick={() => { void load(); }}>{t('refresh')}</button><button type="button" onClick={() => onNavigate('chat')}>{t('newChat')}</button></div>} />
      {error && <Notice tone="error" onDismiss={() => setError('')}><pre>{error}</pre></Notice>}
      <section className="stats-grid" aria-busy={loading}>
        <article className="stat-card"><span>{t('database')}</span><strong>{status?.database === 'ready' ? t('available') : t('unavailable')}</strong><small>{status?.version ?? '—'}</small></article>
        <article className="stat-card"><span>{language === 'ar' ? 'المزوّدات الجاهزة' : 'Verified providers'}</span><strong>{status?.verifiedProviderCount ?? '—'}</strong><small>{language === 'ar' ? `من ${status?.providerCount ?? '—'}` : `of ${status?.providerCount ?? '—'}`}</small><button type="button" className="text-button" onClick={() => onNavigate('providers')}>{t('providers')} ←</button></article>
        <article className="stat-card"><span>{language === 'ar' ? 'التكاملات الجاهزة' : 'Verified integrations'}</span><strong>{status?.verifiedIntegrationCount ?? '—'}</strong><small>{language === 'ar' ? `من ${status?.integrationCount ?? '—'}` : `of ${status?.integrationCount ?? '—'}`}</small><button type="button" className="text-button" onClick={() => onNavigate('integrations')}>{t('integrations')} ←</button></article>
        <article className="stat-card"><span>{language === 'ar' ? 'الأدوات' : 'Tools'}</span><strong>{status?.toolCount ?? '—'}</strong><small>{status ? `${Math.floor(status.uptimeSeconds / 60)}m uptime` : '—'}</small></article>
      </section>

      <section className="capability-section">
        <div className="section-heading"><div><h2>{language === 'ar' ? 'إمكانيات المنصة' : 'Platform capabilities'}</h2><p>{language === 'ar' ? 'اضغط أي بطاقة لفتح إعدادها أو استخدامها.' : 'Open any card to configure or use it.'}</p></div></div>
        <div className="capability-grid" aria-busy={loading}>{capabilities.map((capability) => {
          const enabled = ready?.[capability.key] === true;
          return <button type="button" className={`capability-card ${enabled ? 'ready' : 'needs-setup'}`} key={capability.key} onClick={() => onNavigate(capability.page)}>
            <span className="capability-icon" aria-hidden="true">{capability.icon}</span>
            <span className="capability-copy"><strong>{language === 'ar' ? capability.titleAr : capability.titleEn}</strong><small>{language === 'ar' ? capability.descriptionAr : capability.descriptionEn}</small></span>
            <span className={`capability-state ${enabled ? 'ready' : 'needs-setup'}`}>{enabled ? (language === 'ar' ? 'جاهز' : 'Ready') : (language === 'ar' ? 'يحتاج إعدادًا' : 'Setup required')}</span>
          </button>;
        })}</div>
      </section>

      {!loading && status && status.providerCount === 0 && (
        <EmptyState title={t('noProviders')} description={t('providerRequired')} action={<button type="button" onClick={() => onNavigate('providers')}>{t('addProvider')}</button>} />
      )}
    </div>
  );
}
