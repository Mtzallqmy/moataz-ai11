import React from 'react';
import type { TranslationKey } from '../lib/i18n';
import type { ValidationStatus } from '../types';

type T = (key: TranslationKey) => string;

export function Notice({ tone = 'info', children, onDismiss }: { tone?: 'info' | 'success' | 'error' | 'warning'; children: React.ReactNode; onDismiss?: () => void }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {onDismiss && <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss">×</button>}
    </div>
  );
}

export function StatusBadge({ status, t }: { status: ValidationStatus; t: T }) {
  const key: TranslationKey = status === 'verified' || status === 'ready' ? 'verified' : ['failed', 'invalid_credentials', 'configuration_error'].includes(status) ? 'failed' : 'untested';
  return <span className={`status-badge ${status}`}>{t(key)}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">◇</div><strong>{title}</strong>{description && <p>{description}</p>}{action}</div>;
}

export function SpinnerLabel({ active, activeText, idleText }: { active: boolean; activeText: string; idleText: string }) {
  return <>{active && <span className="spinner" aria-hidden="true" />}{active ? activeText : idleText}</>;
}
