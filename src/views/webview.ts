import { escapeHtml } from '../client/parsers';

export interface ToolbarButton {
  label: string;
  action: string;
  kind?: 'primary' | 'secondary';
  data?: Record<string, string>;
}

export interface PageOptions {
  title: string;
  subtitle?: string;
  chips?: string[];
  toolbar?: ToolbarButton[];
  body: string;
  notice?: string;
}

let nonceCounter = 0;

export function renderPage(options: PageOptions): string {
  const nonce = `vj${Date.now().toString(36)}${(nonceCounter++).toString(36)}`;
  const chips = (options.chips ?? [])
    .filter(Boolean)
    .map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`)
    .join('');
  const toolbar = (options.toolbar ?? [])
    .map((button) => {
      const attrs = Object.entries(button.data ?? {})
        .map(([key, value]) => ` data-${escapeHtml(key)}="${escapeHtml(value)}"`)
        .join('');
      const kind = button.kind === 'primary' ? ' btn-primary' : '';
      return `<button class="btn${kind}" data-action="${escapeHtml(button.action)}"${attrs}>${escapeHtml(
        button.label
      )}</button>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(options.title)}</title>
<style>${webviewStyles}</style>
</head>
<body>
<header class="topbar">
  <div class="head-text">
    <h1>${escapeHtml(options.title)}</h1>
    ${options.subtitle ? `<p class="subtitle">${escapeHtml(options.subtitle)}</p>` : ''}
    ${chips ? `<div class="chips">${chips}</div>` : ''}
  </div>
  ${toolbar ? `<div class="toolbar">${toolbar}</div>` : ''}
</header>
${options.notice ? `<div class="notice">${escapeHtml(options.notice)}</div>` : ''}
<main id="content">${options.body}</main>
<div id="toast" class="toast" hidden></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const toast = document.getElementById('toast');
  let toastTimer = null;

  function showToast(text, ok) {
    if (!toast) return;
    toast.textContent = text;
    toast.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  document.addEventListener('click', function (event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionEl = target.closest('[data-action]');
    if (actionEl) {
      event.preventDefault();
      const action = actionEl.getAttribute('data-action');
      const payload = { type: 'action', action: action };
      for (const attr of Array.from(actionEl.attributes)) {
        if (attr.name.startsWith('data-') && attr.name !== 'data-action') {
          payload[attr.name.slice(5)] = attr.value;
        }
      }
      if (action === 'submit') {
        actionEl.setAttribute('disabled', 'disabled');
        actionEl.textContent = '提交中…';
      }
      vscode.postMessage(payload);
      return;
    }

    const anchor = target.closest('a[href]');
    if (anchor) {
      const href = anchor.getAttribute('href');
      if (href && !href.startsWith('#')) {
        event.preventDefault();
        vscode.postMessage({ type: 'openLink', url: href });
      }
    }
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message) return;
    if (message.type === 'toast') {
      showToast(message.text, message.ok !== false);
    }
    if (message.type === 'resetButtons') {
      document.querySelectorAll('button[data-action="submit"]').forEach(function (btn) {
        btn.removeAttribute('disabled');
        btn.textContent = '提交';
      });
    }
  });
})();
</script>
</body>
</html>`;
}

export const webviewStyles = `
:root {
  --radius: 8px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0 0 48px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  line-height: 1.65;
  word-break: break-word;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 14px 24px;
  background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25));
}
.head-text { min-width: 0; }
h1 {
  font-size: 1.25em;
  margin: 0 0 4px;
  font-weight: 600;
  line-height: 1.4;
}
.subtitle {
  margin: 0 0 6px;
  color: var(--vscode-descriptionForeground);
  font-size: .9em;
}
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font-size: .78em;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-badge-background, rgba(128,128,128,.18));
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25));
  white-space: nowrap;
}
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; flex: 0 0 auto; }
.btn {
  font-family: inherit;
  font-size: .85em;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
  border: 1px solid transparent;
  white-space: nowrap;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn-primary {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn[disabled] { opacity: .6; cursor: default; }
.notice {
  margin: 12px 24px 0;
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: .88em;
  color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
  background: var(--vscode-inputValidation-warningBackground, rgba(255,190,0,.12));
  border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(255,190,0,.4));
}
main {
  padding: 20px 24px 0;
  max-width: 900px;
  margin: 0 auto;
  font-size: .95em;
}
main p { margin: .6em 0; }
h2, h3, h4, h5, h6 { margin: 1.2em 0 .5em; line-height: 1.35; }
h2 { font-size: 1.15em; } h3 { font-size: 1.05em; }
a { color: var(--vscode-textLink-foreground); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; border-radius: 4px; }
code {
  font-family: var(--vscode-editor-font-family);
  font-size: .92em;
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.14));
  padding: 1px 5px;
  border-radius: 4px;
}
pre.vj-code {
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.12));
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.2));
  border-radius: var(--radius);
  padding: 12px 14px;
  overflow: auto;
}
pre.vj-code code { background: none; padding: 0; }
blockquote {
  margin: .8em 0;
  padding: 4px 14px;
  border-left: 3px solid var(--vscode-textLink-foreground);
  color: var(--vscode-descriptionForeground);
  background: rgba(128,128,128,.06);
}
hr { border: none; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25)); margin: 1.2em 0; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: .92em; }
th, td { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); padding: 6px 10px; text-align: left; }
th { background: rgba(128,128,128,.1); }
.vj-empty { color: var(--vscode-descriptionForeground); font-style: italic; }
.vj-prob-ref { font-weight: 600; }

/* 比赛题目列表 */
.problem-list { list-style: none; padding: 0; margin: 8px 0 0; }
.problem-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.22));
  border-radius: var(--radius);
  margin-bottom: 8px;
  background: rgba(128,128,128,.05);
}
.problem-list li:hover { border-color: var(--vscode-focusBorder); }
.badge {
  flex: 0 0 auto;
  min-width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: .82em;
  font-weight: 600;
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
}
.prob-main { min-width: 0; flex: 1 1 auto; }
.prob-title { font-weight: 500; }
.prob-key {
  display: block;
  font-size: .78em;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
}
.prob-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.prob-actions .btn { padding: 3px 9px; font-size: .8em; }

/* 题目页 */
.statement { line-height: 1.75; }
.statement .ptx { margin: .5em 0; }
.section-title {
  margin: 22px 0 8px;
  font-size: 1em;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.statement-note {
  margin-top: 20px;
  font-size: .82em;
  color: var(--vscode-descriptionForeground);
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  max-width: 80%;
  padding: 9px 16px;
  border-radius: 999px;
  font-size: .86em;
  color: var(--vscode-notifications-foreground, #fff);
  background: var(--vscode-notifications-background, #333);
  box-shadow: 0 4px 18px rgba(0,0,0,.28);
  z-index: 20;
}
.toast-ok { border-left: 3px solid var(--vscode-testing-iconPassed, #3ba55d); }
.toast-err { border-left: 3px solid var(--vscode-testing-iconFailed, #e5534b); }
`;
