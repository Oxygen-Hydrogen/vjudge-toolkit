import * as vscode from 'vscode';
import { ArticleInfo, ContestInfo, ProblemInfo, escapeHtml } from '../client/parsers';
import { links } from '../constants';
import { renderMarkdown } from './markdown';
import { PageOptions, ToolbarButton, renderPage } from './webview';

export interface WebviewAction {
  panelKey: string;
  action: string;
  url?: string;
  key?: string;
  contest?: string;
  num?: string;
}

export class ContentPanels implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly onAction: (action: WebviewAction) => void) {}

  showContest(info: ContestInfo): void {
    const body = renderContestBody(info);
    const running = info.begin && info.end ? Date.now() >= info.begin && Date.now() <= info.end : false;
    const page: PageOptions = {
      title: info.title,
      subtitle: `Contest ${info.id}`,
      chips: [
        formatRange(info.begin, info.end),
        `${info.problems.length} 题`,
        running ? '进行中' : info.end && Date.now() > info.end ? '已结束' : '未开始',
      ].filter(Boolean),
      toolbar: [
        { label: '在浏览器打开', action: 'openExternal', data: { url: info.url } },
        { label: '复制链接', action: 'copyLink', data: { url: info.url } },
      ],
      body,
      notice: info.note,
    };
    this.render(`contest-${info.id}`, info.title, page);
  }

  showProblem(info: ProblemInfo, from?: { contestId: string; contestNum: string }): void {
    const chips = [
      info.oj,
      info.num,
      info.timeLimit ? `时间 ${info.timeLimit}` : '',
      info.memoryLimit ? `内存 ${info.memoryLimit}` : '',
    ].filter(Boolean);

    const toolbar: ToolbarButton[] = [
      {
        label: '提交代码',
        action: 'submit',
        kind: 'primary',
        data: from ? { contest: from.contestId, num: from.contestNum, key: info.key } : { key: info.key },
      },
      { label: '在浏览器打开', action: 'openExternal', data: { url: info.url } },
      { label: '复制链接', action: 'copyLink', data: { url: info.url } },
    ];

    const page: PageOptions = {
      title: info.title,
      subtitle: from ? `比赛 ${from.contestId} · 第 ${from.contestNum} 题` : info.key,
      chips,
      toolbar,
      body: `<section class="statement">${info.statementHtml}</section>${
        info.note ? `<p class="statement-note">${escapeHtml(info.note)}</p>` : ''
      }`,
    };
    this.render(`problem-${info.key}`, info.title, page);
  }

  showArticle(info: ArticleInfo): void {
    const page: PageOptions = {
      title: info.title,
      subtitle: info.author ? `作者 ${info.author}` : undefined,
      chips: [
        formatDate(info.createTime),
        info.viewCnt !== undefined ? `${info.viewCnt} 次阅读` : '',
        info.likeCnt !== undefined ? `${info.likeCnt} 赞` : '',
      ].filter(Boolean),
      toolbar: [
        { label: '在浏览器打开', action: 'openExternal', data: { url: info.url } },
        { label: '复制链接', action: 'copyLink', data: { url: info.url } },
      ],
      body: `<article>${renderMarkdown(info.markdown)}</article>`,
      notice: info.note,
    };
    this.render(`article-${info.id}`, info.title, page);
  }

  showMessage(key: string, title: string, message: string): void {
    this.render(key, title, {
      title,
      body: `<p class="vj-empty">${escapeHtml(message)}</p>`,
    });
  }

  toast(panelKey: string, text: string, ok: boolean): void {
    this.panels.get(panelKey)?.webview.postMessage({ type: 'toast', text, ok });
  }

  private render(key: string, title: string, page: PageOptions): void {
    const existing = this.panels.get(key);
    if (existing) {
      existing.title = title;
      existing.webview.html = renderPage(page);
      existing.reveal(vscode.ViewColumn.Beside, true);
      return;
    }

    const panel = vscode.window.createWebviewPanel('vjudge.page', title, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    });
    panel.iconPath = new vscode.ThemeIcon('book');
    panel.webview.html = renderPage(page);
    panel.webview.onDidReceiveMessage((message: Record<string, unknown>) => {
      const action = message.type === 'openLink' ? 'openLink' : String(message.action ?? '');
      this.onAction({
        panelKey: key,
        action,
        url: asText(message.url),
        key: asText(message.key),
        contest: asText(message.contest),
        num: asText(message.num),
      });
    });
    panel.onDidDispose(() => this.panels.delete(key));
    this.panels.set(key, panel);
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function renderContestBody(info: ContestInfo): string {
  if (info.problems.length === 0) {
    return `<p class="vj-empty">没有解析到题目列表。</p>
      <ul class="problem-list">
        <li>
          <span class="badge">?</span>
          <span class="prob-main">
            <a class="prob-title" href="${links.contest(info.id)}">在浏览器中打开比赛页面查看题目</a>
            <span class="prob-key">可能需要先登录 / 加入比赛</span>
          </span>
        </li>
      </ul>`;
  }

  const items = info.problems
    .map((problem) => {
      const label = escapeHtml(problem.num || '·');
      return `<li>
        <span class="badge">${label}</span>
        <span class="prob-main">
          <a class="prob-title" data-action="openProblem" data-contest="${escapeHtml(info.id)}" data-num="${escapeHtml(
            problem.num
          )}" data-key="${escapeHtml(problem.key)}">${escapeHtml(problem.title)}</a>
          <span class="prob-key">${escapeHtml(problem.key)}</span>
        </span>
        <span class="prob-actions">
          <button class="btn btn-primary" data-action="submit" data-contest="${escapeHtml(
            info.id
          )}" data-num="${escapeHtml(problem.num)}" data-key="${escapeHtml(problem.key)}">提交</button>
          <button class="btn" data-action="openExternal" data-url="${escapeHtml(links.problem(problem.key))}">原站</button>
        </span>
      </li>`;
    })
    .join('\n');

  return `<ul class="problem-list">${items}</ul>`;
}

function formatRange(begin?: number, end?: number): string {
  if (!begin || !end) {
    return '';
  }
  return `${formatDate(begin)} ~ ${formatDate(end)}`;
}

function formatDate(ms?: number): string {
  if (!ms) {
    return '';
  }
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
