from pathlib import Path

css_path = Path('client/src/styles/app.css')
css = css_path.read_text()
marker = '/* v1.5 multimodal chat, sessions, API console */'
if marker not in css:
    css += r'''

/* v1.5 multimodal chat, sessions, API console */
.visually-hidden {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}

.composer-shell {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid var(--border);
  background: rgba(6, 10, 20, 0.74);
  backdrop-filter: blur(18px);
}
:root[data-theme="light"] .composer-shell { background: rgba(255,255,255,.78); }
.composer-shell .composer { padding: 0; border: 0; background: transparent; }
.composer-hint { color: var(--muted); line-height: 1.55; }
.attach-button { width: 48px; height: 48px; min-height: 48px; align-self: end; font-size: 1.25rem; border-color: rgba(18,191,244,.38); }
.attachment-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.composer-shell > .attachment-list { margin-top: 0; }
.attachment-chip {
  min-width: 180px;
  max-width: min(100%, 360px);
  display: grid;
  grid-template-columns: auto minmax(0,1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(255,255,255,.045);
}
.attachment-kind { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 10px; background: rgba(124,92,255,.13); }
.attachment-copy { min-width: 0; display: grid; gap: 2px; }
.attachment-copy strong, .attachment-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment-copy small { color: var(--muted); font-size: .72rem; }
.attachment-remove { width: 32px; height: 32px; min-height: 32px; border-radius: 9px; color: var(--danger); }
.msg .attachment-list { margin-bottom: 4px; }

.probe-attempts { display: grid; gap: 7px; padding: 14px; border: 1px solid var(--border); border-radius: 14px; background: rgba(255,255,255,.025); }
.probe-row { display: grid; grid-template-columns: 22px minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--border); }
.probe-row:first-of-type { border-top: 0; }
.probe-row code { color: var(--text); }
.probe-row small { color: var(--muted); }
.probe-row.working > span { color: var(--success); }
.probe-row.failed > span { color: var(--danger); }

.terminal-tabs { display: flex; gap: 8px; padding: 7px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); width: fit-content; }
.terminal-tabs button { min-width: 150px; box-shadow: none; }
.terminal-tabs button.active { color: white; background: linear-gradient(135deg, var(--primary), var(--primary-2)); }
.api-console { display: grid; gap: 18px; }
.api-output { min-height: 240px; max-height: 520px; }
.api-form textarea { direction: ltr; text-align: left; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: .84rem; }
.api-form input[inputmode="url"] { direction: ltr; text-align: left; }

.sessions-panel { display: grid; gap: 4px; }
.session-list { display: grid; gap: 10px; }
.session-card { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px; border: 1px solid var(--border); border-radius: 16px; background: rgba(255,255,255,.025); }
.session-card.current { border-color: rgba(45,212,168,.38); background: rgba(45,212,168,.055); }
.session-card > div { min-width: 0; display: grid; gap: 5px; }
.session-card small { color: var(--muted); overflow-wrap: anywhere; }

@media (max-width: 760px) {
  .composer-shell { position: sticky; inset-block-end: 74px; z-index: 8; }
  .composer-shell .composer { grid-template-columns: 44px minmax(0,1fr); }
  .composer-shell .composer > button:last-child { grid-column: 1 / -1; width: 100%; }
  .attachment-chip { width: 100%; max-width: none; }
  .terminal-tabs { width: 100%; }
  .terminal-tabs button { min-width: 0; flex: 1; }
  .api-form { grid-template-columns: 1fr; }
  .api-form .span-2 { grid-column: 1; }
  .session-card { align-items: stretch; flex-direction: column; }
  .session-card button { width: 100%; }
  .probe-row { grid-template-columns: 22px minmax(0,1fr); }
  .probe-row small { grid-column: 2; }
}
'''
    css_path.write_text(css)

readme = Path('README.md')
text = readme.read_text()
if '## الإصدار 1.5.0' not in text:
    marker = '## التقنيات المستخدمة'
    index = text.find(marker)
    if index < 0:
        raise SystemExit('README marker missing')
    section = '''## الإصدار 1.5.0

- تشخيص المزوّدات أصبح يكتشف النماذج المتاحة للمفتاح، يجربها فعليًا، ويختار نموذجًا عاملًا تلقائيًا بدل قيم مثل `Free` أو `auto`.
- أخطاء مفاتيح المزوّدات لا تُعامل كخطأ جلسة ولا تسجّل خروج المستخدم.
- المحادثات تدعم صورًا وملفات نصية/برمجية وZIP وملفات ثنائية مع حدود حجم وعزل لكل مستخدم.
- وضع **وكلاء متعددين** يستخدم حتى ثلاثة مزوّدات متحققة ثم يجمع النتائج في إجابة واحدة.
- صفحة الطرفية تحتوي وحدة API عامة آمنة تعمل دون Sandbox، بينما Shell الإنتاجي يبقى داخل خدمة Sandbox مستقلة.
- صفحة الإعدادات تعرض الجلسات المحفوظة وتتيح إنهاء الجلسات الأخرى يدويًا.

'''
    readme.write_text(text[:index] + section + text[index:])
