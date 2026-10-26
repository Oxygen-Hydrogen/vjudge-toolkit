import * as vscode from 'vscode';
import { escapeHtml } from '../client/parsers';
import { links } from '../constants';
import { webviewStyles } from './webview';

export interface SubmitContext {
  key: string;
  title: string;
  contestId?: string;
  contestNum?: string;
  version?: string;
  languages: Record<string, string>;
  source: string;
  defaultLanguage?: string;
  openSource: boolean;
}

export interface SubmitValues {
  language: string;
  source: string;
  accessCode: string;
  open: boolean;
}

export interface SubmitOutcome {
  ok: boolean;
  message: string;
}

let currentPanel: SubmitPanel | undefined;

export class SubmitPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: SubmitContext,
    private readonly onSubmit: (values: SubmitValues) => Promise<SubmitOutcome>,
    private readonly onNeedSource: () => string
  ) {
    panel.webview.html = this.buildHtml();
    panel.webview.onDidReceiveMessage(
      (message: Record<string, unknown>) => void this.handle(message),
      undefined,
      this.disposables
    );
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static show(
    ctx: SubmitContext,
    onSubmit: (values: SubmitValues) => Promise<SubmitOutcome>,
    onNeedSource: () => string
  ): SubmitPanel {
    if (currentPanel) {
      currentPanel.dispose();
    }
    const panel = vscode.window.createWebviewPanel(
      'vjudge.submit',
      `提交 · ${ctx.key}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.iconPath = new vscode.ThemeIcon('cloud-upload');
    currentPanel = new SubmitPanel(panel, ctx, onSubmit, onNeedSource);
    return currentPanel;
  }

  private async handle(message: Record<string, unknown>): Promise<void> {
    switch (message.type) {
      case 'submit':
        await this.submit({
          language: String(message.language ?? ''),
          source: String(message.source ?? ''),
          accessCode: String(message.accessCode ?? ''),
          open: Boolean(message.open),
        });
        return;
      case 'reloadCode':
        this.panel.webview.postMessage({ type: 'setSource', source: this.onNeedSource() });
        return;
      case 'openExternal':
        void vscode.env.openExternal(vscode.Uri.parse(String(message.url ?? links.problem(this.context.key))));
        return;
      default:
        return;
    }
  }

  private async submit(values: SubmitValues): Promise<void> {
    if (!values.source.trim()) {
      this.panel.webview.postMessage({ type: 'result', ok: false, text: '代码是空的。' });
      return;
    }
    if (!values.language.trim()) {
      this.panel.webview.postMessage({ type: 'result', ok: false, text: '请选择语言。' });
      return;
    }
    this.panel.webview.postMessage({ type: 'busy', busy: true });
    try {
      const outcome = await this.onSubmit(values);
      this.panel.webview.postMessage({ type: 'result', ok: outcome.ok, text: outcome.message });
    } catch (err) {
      this.panel.webview.postMessage({
        type: 'result',
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.panel.webview.postMessage({ type: 'busy', busy: false });
    }
  }

  private buildHtml(): string {
    const { context } = this;
    const languageField =
      Object.keys(context.languages).length > 0
        ? `<select id="language">${Object.entries(context.languages)
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([id, name]) => {
              const selected = id === context.defaultLanguage ? ' selected' : '';
              return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(name)}</option>`;
            })
            .join('')}</select>`
        : `<input id="language" type="text" placeholder="语言 ID，例如 54" value="${escapeHtml(
            context.defaultLanguage ?? ''
          )}">
           <p class="hint">没能在题目页解析出语言列表，需要手动填写 Vjudge 的语言编号。</p>`;

    const accessCodeField = context.contestId
      ? `<label class="field">
           <span>比赛密码 / 访问码（如果比赛需要）</span>
           <input id="accessCode" type="text" placeholder="没有就留空">
         </label>`
      : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>提交 ${escapeHtml(context.key)}</title>
<style>${webviewStyles}
body { padding: 0; }
main { max-width: 860px; padding: 18px 24px 32px; }
.field { display: block; margin-bottom: 14px; }
.field > span { display: block; font-size: .85em; color: var(--vscode-descriptionForeground); margin-bottom: 5px; }
label.check { display: flex; align-items: center; gap: 8px; font-size: .88em; margin-bottom: 14px; }
select, input[type="text"] {
  width: 100%;
  padding: 6px 9px;
  border-radius: 6px;
  font-family: inherit;
  font-size: .92em;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
}
textarea {
  width: 100%;
  min-height: 320px;
  padding: 10px 12px;
  border-radius: 6px;
  resize: vertical;
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size, 13px);
  line-height: 1.5;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, rgba(128,128,128,.35));
}
.hint { margin: 4px 0 0; font-size: .78em; color: var(--vscode-descriptionForeground); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.spacer { flex: 1 1 auto; }
#result { display: none; margin-top: 14px; padding: 10px 14px; border-radius: 8px; font-size: .9em; white-space: pre-wrap; }
#result.ok { display: block; background: rgba(59,165,93,.14); border: 1px solid rgba(59,165,93,.45); }
#result.err { display: block; background: rgba(229,83,75,.12); border: 1px solid rgba(229,83,75,.45); }
</style>
</head>
<body>
<header class="topbar">
  <div class="head-text">
    <h1>${escapeHtml(context.title)}</h1>
    <div class="chips">
      <span class="chip">${escapeHtml(context.key)}</span>
      ${context.contestId ? `<span class="chip">比赛 ${escapeHtml(context.contestId)} · ${escapeHtml(context.contestNum ?? '')}</span>` : ''}
    </div>
  </div>
  <div class="toolbar">
    <button class="btn" id="btn-reload">用当前编辑器内容填充</button>
    <button class="btn" id="btn-browser">在浏览器打开</button>
  </div>
</header>
<main>
  <label class="field">
    <span>语言</span>
    ${languageField}
  </label>
  ${accessCodeField}
  <label class="check">
    <input id="open" type="checkbox"${context.openSource ? ' checked' : ''}>
    <span>公开代码</span>
  </label>
  <label class="field">
    <span>源代码</span>
    <textarea id="source" spellcheck="false">${escapeHtml(context.source)}</textarea>
  </label>
  <div class="row">
    <button class="btn btn-primary" id="btn-submit">提交</button>
    <span class="spacer"></span>
  </div>
  <div id="result"></div>
</main>
<script>
(function () {
  const vscode = acquireVsCodeApi();
  const result = document.getElementById('result');
  const submitBtn = document.getElementById('btn-submit');
  const source = document.getElementById('source');

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? '提交中…' : '提交';
  }

  function showResult(ok, text) {
    result.className = ok ? 'ok' : 'err';
    result.textContent = text;
  }

  submitBtn.addEventListener('click', function () {
    const languageEl = document.getElementById('language');
    vscode.postMessage({
      type: 'submit',
      language: languageEl ? languageEl.value : '',
      source: source.value,
      accessCode: document.getElementById('accessCode') ? document.getElementById('accessCode').value : '',
      open: document.getElementById('open').checked
    });
  });

  document.getElementById('btn-reload').addEventListener('click', function () {
    vscode.postMessage({ type: 'reloadCode' });
  });

  document.getElementById('btn-browser').addEventListener('click', function () {
    vscode.postMessage({ type: 'openExternal', url: '${links.problem(context.key)}' });
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message) return;
    if (message.type === 'busy') setBusy(Boolean(message.busy));
    if (message.type === 'result') { setBusy(false); showResult(message.ok, message.text); }
    if (message.type === 'setSource') source.value = message.source;
  });
})();
</script>
</body>
</html>`;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.panel.dispose();
    if (currentPanel === this) {
      currentPanel = undefined;
    }
  }
}
