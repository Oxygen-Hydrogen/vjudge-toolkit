import * as vscode from 'vscode';
import { BASE_URL, links } from './constants';
import { HttpClient } from './client/httpClient';
import { Session } from './client/session';
import { NotLoggedInError, VjudgeClient } from './client/vjudgeClient';
import { findVjudgeUrl, parseTarget, splitProblemKey } from './client/parsers';
import { Store } from './store';
import { VjudgeTreeProvider } from './providers/treeProvider';
import { ContentPanels, WebviewAction } from './views/contentPanels';
import { SubmitPanel, SubmitValues } from './views/submitPanel';
import { getSettings } from './utils/config';
import { logger } from './utils/logger';

/** 打开某个题目时记住的上下文，提交时要用 */
interface ProblemContext {
  key: string;
  title: string;
  languages: Record<string, string>;
  contestId?: string;
  contestNum?: string;
  version?: string;
}

export class App implements vscode.Disposable {
  readonly session: Session;
  readonly store: Store;
  readonly tree: VjudgeTreeProvider;
  readonly panels: ContentPanels;

  private http: HttpClient;
  private client: VjudgeClient;
  private readonly contexts = new Map<string, ProblemContext>();
  private lastTarget: { key: string; contestId?: string; contestNum?: string } | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.session = new Session(context);
    this.store = new Store(context);
    this.tree = new VjudgeTreeProvider(this.store);
    this.panels = new ContentPanels((action) => void this.handleWebviewAction(action));

    const settings = getSettings();
    this.http = new HttpClient(this.session.jar, settings.userAgent, settings.requestTimeout, settings.baseUrl);
    this.client = new VjudgeClient(this.http, this.session);

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vjudge')) {
          const next = getSettings();
          this.http = new HttpClient(this.session.jar, next.userAgent, next.requestTimeout, next.baseUrl);
          this.client = new VjudgeClient(this.http, this.session);
        }
      })
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.panels.dispose();
  }

  /* ------------------------------------------------------------------ *
   * 登录
   * ------------------------------------------------------------------ */

  async login(force = false): Promise<boolean> {
    if (!force && this.session.hasCookies && (await this.client.checkLoggedIn())) {
      vscode.window.showInformationMessage(`Vjudge 已登录${this.session.username ? `：${this.session.username}` : ''}`);
      return true;
    }

    const username = await vscode.window.showInputBox({
      title: 'Vjudge 登录',
      prompt: '用户名',
      value: this.session.username ?? '',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : '请输入用户名'),
    });
    if (!username) {
      return false;
    }

    const savedPassword = await this.session.getPassword();
    const password = await vscode.window.showInputBox({
      title: 'Vjudge 登录',
      prompt: '密码（保存在 VS Code 的密钥存储里）',
      password: true,
      value: savedPassword ?? '',
      ignoreFocusOut: true,
      validateInput: (value) => (value ? undefined : '请输入密码'),
    });
    if (!password) {
      return false;
    }

    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在登录 Vjudge…' },
        async () => {
          await this.client.login(username.trim(), password);
          await this.session.savePassword(password);
        }
      );
      vscode.window.showInformationMessage(`Vjudge 登录成功：${username}`);
      this.tree.refresh();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('login failed', err);
      vscode.window.showErrorMessage(`Vjudge 登录失败：${message}`);
      return false;
    }
  }

  /** 人机验证挡住密码登录时的备选方案：直接复用浏览器里的 Cookie */
  async loginWithCookie(): Promise<boolean> {
    const cookie = await vscode.window.showInputBox({
      title: '使用浏览器 Cookie 登录',
      prompt: '在浏览器打开 vjudge.net，F12 → Network → 任意请求 → 复制 Cookie 请求头（含 JSESSIONID）',
      placeHolder: 'JSESSIONID=xxxx; JSESSlONID=yyyy',
      ignoreFocusOut: true,
      validateInput: (value) => (/JSESS?IONID=/i.test(value) ? undefined : 'Cookie 里需要有 JSESSIONID'),
    });
    if (!cookie) {
      return false;
    }

    const username = await vscode.window.showInputBox({
      title: '使用浏览器 Cookie 登录',
      prompt: '用户名（可选，只用于界面显示）',
      value: this.session.username ?? '',
      ignoreFocusOut: true,
    });

    try {
      await this.client.loginWithCookie(cookie, username?.trim() || undefined);
      vscode.window.showInformationMessage('已使用浏览器 Cookie 接管 Vjudge 会话。');
      this.tree.refresh();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('cookie login failed', err);
      vscode.window.showErrorMessage(`Cookie 登录失败：${message}`);
      return false;
    }
  }

  async logout(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage('确定退出 Vjudge 登录吗？', { modal: true }, '退出');
    if (confirm !== '退出') {
      return;
    }
    await this.client.logout();
    vscode.window.showInformationMessage('已退出 Vjudge 登录，本地保存的密码已删除。');
    this.tree.refresh();
  }

  async showStatus(): Promise<void> {
    const loggedIn = await this.client.checkLoggedIn();
    if (loggedIn) {
      vscode.window.showInformationMessage(`Vjudge 已登录：${this.session.username ?? '(未知用户)'}`);
    } else {
      const choice = await vscode.window.showWarningMessage('Vjudge 未登录。', '登录');
      if (choice === '登录') {
        await this.login(true);
      }
    }
  }

  private async requireLogin(): Promise<void> {
    const loggedIn = this.session.hasCookies ? await this.client.checkLoggedIn() : false;
    if (loggedIn) {
      return;
    }
    const ok = await this.login(true);
    if (!ok) {
      throw new NotLoggedInError('需要登录后才能继续。');
    }
  }

  /* ------------------------------------------------------------------ *
   * 打开比赛 / 题目 / 文章
   * ------------------------------------------------------------------ */

  async openContest(contestId: string): Promise<void> {
    const mode = getSettings().openMode;
    if (mode !== 'webview') {
      await this.openExternally(links.contest(contestId));
      return;
    }
    try {
      const info = await this.runWithLoginGuard(() =>
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `加载比赛 ${contestId}…` },
          () => this.client.fetchContest(contestId)
        )
      );
      this.panels.showContest(info);
      await this.store.addContest({
        id: info.id,
        title: info.title,
        begin: info.begin,
        end: info.end,
        version: info.version,
        problems: info.problems,
        addedAt: Date.now(),
      });
    } catch (err) {
      await this.reportError(`打开比赛 ${contestId} 失败`, err);
    }
  }

  async openContestProblem(contestId: string, contestNum: string, key: string): Promise<void> {
    const split = splitProblemKey(key);
    if (!split) {
      await this.openExternally(links.contestProblem(contestId, contestNum));
      return;
    }
    await this.openProblem(split.oj, split.num, { contestId, contestNum });
  }

  async openProblemByKey(key: string): Promise<void> {
    const split = splitProblemKey(key);
    if (!split) {
      vscode.window.showErrorMessage(`无法识别题目 ID：${key}（应形如 CodeForces-1A）`);
      return;
    }
    await this.openProblem(split.oj, split.num);
  }

  private async openProblem(
    oj: string,
    num: string,
    from?: { contestId: string; contestNum: string }
  ): Promise<void> {
    const key = `${oj}-${num}`;
    if (getSettings().openMode !== 'webview') {
      await this.openExternally(from ? links.contestProblem(from.contestId, from.contestNum) : links.problem(key));
      return;
    }

    try {
      const contest = from ? this.store.contests.find((item) => item.id === from.contestId) : undefined;
      const info = await this.runWithLoginGuard(() =>
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `加载题目 ${key}…` },
          () => this.client.fetchProblem(oj, num)
        )
      );

      this.contexts.set(contextKey(key, from?.contestId), {
        key,
        title: info.title,
        languages: info.languages,
        contestId: from?.contestId,
        contestNum: from?.contestNum,
        version: contest?.version,
      });
      this.lastTarget = { key, contestId: from?.contestId, contestNum: from?.contestNum };

      this.panels.showProblem(info, from);
      await this.store.addProblem({ key, title: info.title, addedAt: Date.now() });
    } catch (err) {
      await this.reportError(`打开题目 ${key} 失败`, err);
    }
  }

  async openArticle(articleId: string): Promise<void> {
    if (getSettings().openMode !== 'webview') {
      await this.openExternally(links.article(articleId));
      return;
    }
    try {
      const info = await this.runWithLoginGuard(() =>
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `加载文章 ${articleId}…` },
          () => this.client.fetchArticle(articleId)
        )
      );
      this.panels.showArticle(info);
      await this.store.addArticle({ id: info.id, title: info.title, addedAt: Date.now() });
    } catch (err) {
      await this.reportError(`打开文章 ${articleId} 失败`, err);
    }
  }

  /** 只知道比赛 ID + 题号（例如粘贴了 #problem/A 的链接）时，先查出题目 key */
  async openContestProblemByNum(contestId: string, num: string): Promise<void> {
    const record = this.store.contests.find((item) => item.id === contestId);
    let problem = record?.problems.find((item) => item.num.toUpperCase() === num.toUpperCase());

    if (!problem) {
      if (getSettings().openMode !== 'webview') {
        await this.openExternally(links.contestProblem(contestId, num));
        return;
      }
      try {
        const info = await this.runWithLoginGuard(() =>
          vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `加载比赛 ${contestId}…` },
            () => this.client.fetchContest(contestId)
          )
        );
        await this.store.addContest({
          id: info.id,
          title: info.title,
          begin: info.begin,
          end: info.end,
          version: info.version,
          problems: info.problems,
          addedAt: Date.now(),
        });
        problem = info.problems.find((item) => item.num.toUpperCase() === num.toUpperCase());
      } catch (err) {
        await this.reportError(`加载比赛 ${contestId} 失败`, err);
        return;
      }
    }

    if (!problem) {
      const choice = await vscode.window.showWarningMessage(
        `比赛 ${contestId} 里没有找到题号 ${num}。`,
        '在浏览器打开'
      );
      if (choice === '在浏览器打开') {
        await this.openExternally(links.contestProblem(contestId, num));
      }
      return;
    }
    await this.openContestProblem(contestId, problem.num, problem.key);
  }

  /** 智能识别输入：比赛 ID / 题目 key / 文章 ID / 完整链接 */
  async openAnything(input: string, hint: 'contest' | 'problem' | 'article'): Promise<void> {
    const target = parseTarget(input, hint);
    switch (target.kind) {
      case 'contest':
        await this.openContest(target.contestId);
        return;
      case 'contestProblem':
        await this.openContestProblemByNum(target.contestId, target.num);
        return;
      case 'problem':
        await this.openProblemByKey(`${target.oj}-${target.num}`);
        return;
      case 'article':
        await this.openArticle(target.articleId);
        return;
      default:
        vscode.window.showErrorMessage(`无法识别的输入：${input}`);
    }
  }

  /** 任意 URL：vjudge 的链接走原生渲染，其它交给浏览器 */
  async openUrl(url: string): Promise<void> {
    const target = parseTarget(url, 'problem');
    if (target.kind === 'contestProblem') {
      await this.openContestProblemByNum(target.contestId, target.num);
      return;
    }
    if (target.kind === 'problem') {
      await this.openProblemByKey(`${target.oj}-${target.num}`);
      return;
    }
    if (target.kind === 'contest') {
      await this.openContest(target.contestId);
      return;
    }
    if (target.kind === 'article') {
      await this.openArticle(target.articleId);
      return;
    }
    await this.openExternally(url);
  }

  async openExternally(url: string): Promise<void> {
    const mode = getSettings().openMode;
    if (mode === 'simpleBrowser') {
      await vscode.commands.executeCommand('simpleBrowser.show', url);
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /* ------------------------------------------------------------------ *
   * 提交
   * ------------------------------------------------------------------ */

  /** 从题目面板 / 侧边栏点“提交” */
  async beginSubmit(target: { key: string; contestId?: string; contestNum?: string }): Promise<void> {
    const context = await this.resolveContext(target.key, target.contestId, target.contestNum);
    if (!context) {
      return;
    }
    const settings = getSettings();
    const source = this.activeEditorSource();

    SubmitPanel.show(
      {
        key: context.key,
        title: context.title,
        contestId: context.contestId,
        contestNum: context.contestNum,
        version: context.version,
        languages: context.languages,
        source,
        defaultLanguage: settings.languageId || Object.keys(context.languages)[0],
        openSource: settings.openSource,
      },
      (values) => this.performSubmit(context, values),
      () => this.activeEditorSource()
    );
  }

  /** 命令：提交当前文件 */
  async submitActiveFile(): Promise<void> {
    const target = this.lastTarget ?? this.inferTargetFromEditor();
    if (!target) {
      const input = await vscode.window.showInputBox({
        title: '提交代码',
        prompt: '要提交到哪道题？可以填 CodeForces-1A 这样的 ID 或 vjudge 链接',
        ignoreFocusOut: true,
      });
      if (!input) {
        return;
      }
      const parsed = parseTarget(input, 'problem');
      if (parsed.kind !== 'problem') {
        vscode.window.showErrorMessage('无法识别题目 ID。');
        return;
      }
      await this.beginSubmit({ key: `${parsed.oj}-${parsed.num}` });
      return;
    }
    await this.beginSubmit(target);
  }

  private inferTargetFromEditor(): { key: string; contestId?: string; contestNum?: string } | undefined {
    const text = this.activeEditorSource().slice(0, 1200);
    const url = findVjudgeUrl(text);
    if (!url) {
      return undefined;
    }
    const parsed = parseTarget(url, 'problem');
    if (parsed.kind === 'problem') {
      return { key: `${parsed.oj}-${parsed.num}` };
    }
    return undefined;
  }

  private async resolveContext(
    key: string,
    contestId?: string,
    contestNum?: string
  ): Promise<ProblemContext | undefined> {
    const cacheKey = contextKey(key, contestId);
    const cached = this.contexts.get(cacheKey);
    if (cached) {
      return cached;
    }

    const split = splitProblemKey(key);
    if (!split) {
      vscode.window.showErrorMessage(`无法识别的题目 ID：${key}`);
      return undefined;
    }

    try {
      const info = await this.runWithLoginGuard(() => this.client.fetchProblem(split.oj, split.num));
      const contest = contestId ? this.store.contests.find((item) => item.id === contestId) : undefined;
      const context: ProblemContext = {
        key,
        title: info.title,
        languages: info.languages,
        contestId,
        contestNum,
        version: contest?.version,
      };
      this.contexts.set(cacheKey, context);
      this.lastTarget = { key, contestId, contestNum };
      return context;
    } catch {
      // 拿不到语言列表也让用户继续，提交面板里可以手填语言 ID
      return { key, title: key, languages: {}, contestId, contestNum };
    }
  }

  private async performSubmit(
    context: ProblemContext,
    values: SubmitValues
  ): Promise<{ ok: boolean; message: string }> {
    await this.requireLogin();

    const result = await this.client.submit({
      contestId: context.contestId,
      contestNum: context.contestNum,
      oj: splitProblemKey(context.key)?.oj,
      probNum: splitProblemKey(context.key)?.num,
      language: values.language,
      source: values.source,
      accessCode: values.accessCode,
      version: context.version,
      openSource: values.open,
    });

    if (result.ok) {
      const id = result.runId !== undefined ? `（Run ID ${result.runId}）` : '';
      const action = await vscode.window.showInformationMessage(`提交成功${id}`, '查看提交记录');
      if (action === '查看提交记录') {
        await this.openExternally(links.status());
      }
      return { ok: true, message: `提交成功${id}` };
    }

    if (result.needChallenge) {
      return this.fallbackToBrowser(context, values, result.message);
    }
    return { ok: false, message: result.message };
  }

  /** 人机验证 / 接口变化时的兜底：复制代码 + 打开提交页 */
  private async fallbackToBrowser(
    context: ProblemContext,
    values: SubmitValues,
    reason: string
  ): Promise<{ ok: boolean; message: string }> {
    const settings = getSettings();
    const url = context.contestId
      ? links.contestProblem(context.contestId, context.contestNum ?? '')
      : links.problem(context.key);

    if (settings.copyOnFallback) {
      await vscode.env.clipboard.writeText(values.source);
    }
    await this.openExternally(url);

    const message = `${reason}\n代码已${settings.copyOnFallback ? '复制到剪贴板' : '保留在编辑器'}，请在打开的页面里粘贴提交。`;
    vscode.window.showWarningMessage(message);
    return { ok: false, message };
  }

  /* ------------------------------------------------------------------ *
   * 链接与调试
   * ------------------------------------------------------------------ */

  async copyProblemLink(key: string): Promise<void> {
    await vscode.env.clipboard.writeText(links.problem(key));
    vscode.window.setStatusBarMessage(`已复制题目链接：${links.problem(key)}`, 3000);
  }

  async copySubmitLink(key: string, contestId?: string, contestNum?: string): Promise<void> {
    const url = contestId ? links.contestProblem(contestId, contestNum ?? '') : `${links.problem(key)}#submit`;
    await vscode.env.clipboard.writeText(url);
    vscode.window.setStatusBarMessage(`已复制提交链接：${url}`, 3000);
  }

  async openSubmitPage(key: string, contestId?: string, contestNum?: string): Promise<void> {
    const url = contestId ? links.contestProblem(contestId, contestNum ?? '') : `${links.problem(key)}#submit`;
    await this.openExternally(url);
  }

  /** 从当前编辑器首行注释里找 vjudge 链接，加入侧边栏 */
  async captureCurrent(): Promise<void> {
    const text = this.activeEditorSource().slice(0, 1500);
    const url = findVjudgeUrl(text);
    if (!url) {
      vscode.window.showWarningMessage('当前文件的前若干行里没有找到 vjudge 链接。');
      return;
    }
    await this.openUrl(url);
  }

  /** 调试：把抓到的原始 HTML 打开成只读文档 */
  async showRawHtml(url: string): Promise<void> {
    try {
      const html = await this.runWithLoginGuard(() => this.client.fetchRaw(url));
      const doc = await vscode.workspace.openTextDocument({ language: 'html', content: html });
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      await this.reportError('抓取页面失败', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * webview 消息
   * ------------------------------------------------------------------ */

  private async handleWebviewAction(action: WebviewAction): Promise<void> {
    try {
      switch (action.action) {
        case 'openLink':
        case 'openExternal':
          if (action.url) {
            await this.openUrl(action.url);
          }
          return;
        case 'copyLink':
          if (action.url) {
            await vscode.env.clipboard.writeText(action.url);
            this.panels.toast(action.panelKey, '已复制链接', true);
          }
          return;
        case 'openProblem':
          if (action.contest && action.key) {
            await this.openContestProblem(action.contest, action.num ?? '', action.key);
          }
          return;
        case 'submit':
          if (action.key) {
            await this.beginSubmit({ key: action.key, contestId: action.contest, contestNum: action.num });
          }
          return;
        default:
          return;
      }
    } catch (err) {
      await this.reportError('操作失败', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 工具
   * ------------------------------------------------------------------ */

  private activeEditorSource(): string {
    const editor = vscode.window.activeTextEditor;
    return editor ? editor.document.getText() : '';
  }

  private async runWithLoginGuard<T>(fn: () => PromiseLike<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NotLoggedInError) {
        const ok = await this.login(true);
        if (ok) {
          return await fn();
        }
      }
      throw err;
    }
  }

  private async reportError(title: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(title, err);
    const choice = await vscode.window.showErrorMessage(`${title}：${message}`, '查看日志');
    if (choice === '查看日志') {
      logger.show();
    }
  }

  /* 供命令层使用的小工具 */
  get siteHome(): string {
    return BASE_URL;
  }
}

/** 同一道题在“比赛里”和“练习模式”下是不同的上下文，缓存要分开 */
function contextKey(problemKey: string, contestId?: string): string {
  return `${contestId ?? ''}|${problemKey}`;
}
