import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { useT, type Language, type TranslationKey } from './lib/i18n';
import { formatError } from './lib/errors';
import { HomePage } from './pages/HomePage';
import { ProvidersPage } from './pages/ProvidersPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { ChatPage } from './pages/ChatPage';
import { TerminalPage } from './pages/TerminalPage';
import { SettingsPage } from './pages/SettingsPage';
import './styles/app.css';

type T = (key: TranslationKey) => string;
type Page = 'home' | 'chat' | 'providers' | 'integrations' | 'terminal' | 'settings';

function App() {
  const { status, logout } = useAuth();
  const [language, setLanguage] = useState<Language>((localStorage.getItem('moataz_lang') as Language | null) ?? 'ar');
  const [theme, setTheme] = useState(localStorage.getItem('moataz_theme') ?? 'dark');
  const t = useT(language);

  useEffect(() => {
    document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', language);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('moataz_lang', language);
    localStorage.setItem('moataz_theme', theme);
  }, [language, theme]);

  if (status === 'loading') return <div className="login-screen"><div className="login-card"><div className="brand centered"><div className="logo">M</div><strong>Moataz AI</strong></div><div className="loading-line" /><p>{t('loading')}</p></div></div>;
  if (status === 'unauthenticated') return <Login t={t} language={language} />;
  return <Dashboard t={t} language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} onLogout={() => { void logout(); }} />;
}

function Login({ t, language }: { t: T; language: Language }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try { await login({ email, password }); }
    catch (caught) { setError(formatError(caught, language)); }
    finally { setLoading(false); }
  };

  return <div className="login-screen"><div className="login-card"><div className="brand centered"><div className="logo">M</div><div><strong>Moataz AI</strong><small>Production Agent Platform</small></div></div><div className="login-copy"><h1>{t('login')}</h1><p>{language === 'ar' ? 'أدخل بيانات حساب المدير الذي أنشأته من متغيرات Railway.' : 'Use the administrator credentials configured in Railway.'}</p></div>{error && <pre className="login-error" role="alert">{error}</pre>}<form onSubmit={submit} className="form-grid one-column"><label><span>{t('email')}</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label><span>{t('password')}</span><input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button type="submit" disabled={loading}>{loading ? t('loading') : t('login')}</button></form></div></div>;
}

const navigation: Array<{ page: Page; label: TranslationKey; icon: string }> = [
  { page: 'home', label: 'dashboard', icon: '⌂' },
  { page: 'chat', label: 'chat', icon: '◌' },
  { page: 'providers', label: 'providers', icon: '✦' },
  { page: 'integrations', label: 'integrations', icon: '⇄' },
  { page: 'terminal', label: 'terminal', icon: '›_' },
  { page: 'settings', label: 'settings', icon: '⚙' }
];

function Dashboard({ t, language, setLanguage, theme, setTheme, onLogout }: { t: T; language: Language; setLanguage: (value: Language) => void; theme: string; setTheme: (value: string) => void; onLogout: () => void }) {
  const { request, user } = useAuth();
  const [page, setPage] = useState<Page>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = (value: Page) => { setPage(value); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return <div className="app-shell">
    <header className="mobile-header"><div className="brand"><div className="logo small">M</div><strong>Moataz AI</strong></div><button type="button" className="icon-button menu-button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label={t('menu')}>☰</button></header>
    {menuOpen && <button type="button" className="nav-backdrop" onClick={() => setMenuOpen(false)} aria-label={t('close')} />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand sidebar-brand"><div className="logo">M</div><div><strong>Moataz AI</strong><small>{user?.name || user?.email}</small></div></div>
      <nav>{navigation.map((item) => <button type="button" key={item.page} className={page === item.page ? 'active' : ''} onClick={() => navigate(item.page)}><span aria-hidden="true">{item.icon}</span><span>{t(item.label)}</span></button>)}</nav>
      <div className="sidebar-footer"><div className="user-chip"><span>{user?.name?.slice(0, 1).toUpperCase() || 'U'}</span><div><strong>{user?.name}</strong><small>{user?.email}</small></div></div><button type="button" className="ghost logout-button" onClick={onLogout}>{t('logout')}</button></div>
    </aside>
    <main className="main-content">
      {page === 'home' && <HomePage request={request} t={t} language={language} onNavigate={(next) => navigate(next)} />}
      {page === 'chat' && <ChatPage request={request} t={t} language={language} onNavigate={() => navigate('providers')} />}
      {page === 'providers' && <ProvidersPage request={request} t={t} language={language} />}
      {page === 'integrations' && <IntegrationsPage request={request} t={t} language={language} />}
      {page === 'terminal' && <TerminalPage request={request} t={t} language={language} />}
      {page === 'settings' && <SettingsPage request={request} t={t} language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} />}
    </main>
    <nav className="bottom-nav" aria-label="Mobile navigation">{navigation.slice(0, 5).map((item) => <button type="button" key={item.page} className={page === item.page ? 'active' : ''} onClick={() => navigate(item.page)}><span>{item.icon}</span><small>{t(item.label)}</small></button>)}</nav>
  </div>;
}

const container = document.getElementById('root');
if (container) createRoot(container).render(<AuthProvider><App /></AuthProvider>);
