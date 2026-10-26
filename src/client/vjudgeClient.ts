import { BASE_URL, ENDPOINTS, links } from '../constants';
import { logger } from '../utils/logger';
import { HttpClient } from './httpClient';
import {
  ArticleInfo,
  ContestInfo,
  ProblemInfo,
  parseArticle,
  parseContest,
  parseProblem,
} from './parsers';
import { Session } from './session';

export class NotLoggedInError extends Error {
  constructor(message = '当前未登录 Vjudge，或登录状态已失效。') {
    super(message);
    this.name = 'NotLoggedInError';
  }
}

export interface SubmitOptions {
  /** 比赛提交时提供 */
  contestId?: string;
  /** 比赛内题号（A / B / 1 …） */
  contestNum?: string;
  /** 练习题提交时提供 */
  oj?: string;
  probNum?: string;
  language: string;
  source: string;
  accessCode?: string;
  version?: string;
  openSource?: boolean;
}

export interface SubmitResult {
  ok: boolean;
  message: string;
  runId?: string | number;
  /** Vjudge 要求人机验证（Cloudflare Turnstile），需要用户在浏览器里完成 */
  needChallenge?: boolean;
  /** 可以继续提示给用户的原始返回 */
  raw?: string;
}

export class VjudgeClient {
  constructor(
    private readonly http: HttpClient,
    private readonly session: Session
  ) {}

  get username(): string | undefined {
    return this.session.username;
  }

  /* ---------------- 账号 ---------------- */

  async login(username: string, password: string): Promise<void> {
    const res = await this.http.postForm(`${BASE_URL}${ENDPOINTS.login}`, { username, password });
    await this.session.persistCookies();

    const body = res.body.trim();
    logger.info(`login response: ${res.status} ${body.slice(0, 200)}`);

    if (res.status === 401 || /invalid_credentials/i.test(body)) {
      throw new Error('用户名或密码错误');
    }
    if (/captcha|turnstile|challenge/i.test(body)) {
      throw new Error('Vjudge 要求完成人机验证。可以改用「使用浏览器 Cookie 登录」命令。');
    }
    if (res.status >= 400) {
      throw new Error(extractMessage(body) ?? `登录失败（HTTP ${res.status}）`);
    }

    const ok = await this.checkLoggedIn();
    if (!ok) {
      throw new Error(extractMessage(body) ?? '登录失败：Vjudge 没有返回有效会话');
    }
    await this.session.setUsername(username);
  }

  /** 用浏览器里已有的 Cookie 直接接管会话（绕开人机验证） */
  async loginWithCookie(rawCookie: string, username?: string): Promise<void> {
    const text = rawCookie.trim().replace(/^Cookie\s*:\s*/i, '');
    if (!/JSESS?IONID=/i.test(text)) {
      throw new Error('Cookie 里没有找到 JSESSIONID，请确认复制的是 vjudge.net 的完整 Cookie。');
    }
    for (const part of text.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) {
        this.session.jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
      }
    }
    await this.session.persistCookies();

    const ok = await this.checkLoggedIn();
    if (!ok) {
      throw new Error('这份 Cookie 已经失效，请重新从浏览器复制。');
    }
    if (username) {
      await this.session.setUsername(username);
    }
  }

  async logout(): Promise<void> {
    try {
      await this.http.get(`${BASE_URL}${ENDPOINTS.logout}`);
    } catch (err) {
      logger.warn(`logout failed: ${String(err)}`);
    }
    await this.session.clear();
  }

  async checkLoggedIn(): Promise<boolean> {
    try {
      const res = await this.http.get(`${BASE_URL}${ENDPOINTS.loginStatus}`);
      return /true/i.test(res.body.trim());
    } catch (err) {
      logger.warn(`checkLogInStatus failed: ${String(err)}`);
      return false;
    }
  }

  /* ---------------- 页面 ---------------- */

  async fetchContest(contestId: string): Promise<ContestInfo> {
    const res = await this.http.get(`${BASE_URL}${ENDPOINTS.contest(contestId)}`);
    this.guardLogin(res.url, res.body);
    const info = parseContest(res.body, contestId);
    logger.info(`contest ${contestId}: ${info.problems.length} problems`);
    return info;
  }

  async fetchProblem(oj: string, num: string): Promise<ProblemInfo> {
    const key = `${oj}-${num}`;
    const res = await this.http.get(`${BASE_URL}${ENDPOINTS.problem(key)}`);
    this.guardLogin(res.url, res.body);
    return parseProblem(res.body, oj, num);
  }

  async fetchArticle(articleId: string): Promise<ArticleInfo> {
    const res = await this.http.get(`${BASE_URL}${ENDPOINTS.article(articleId)}`);
    return parseArticle(res.body, articleId);
  }

  /** 拉取原始 HTML，用于调试和兜底渲染 */
  async fetchRaw(url: string): Promise<string> {
    const res = await this.http.get(url);
    return res.body;
  }

  /* ---------------- 提交 ---------------- */

  async submit(options: SubmitOptions): Promise<SubmitResult> {
    const inContest = Boolean(options.contestId);
    const url = inContest
      ? `${BASE_URL}${ENDPOINTS.contestSubmit(options.contestId!, options.contestNum ?? '')}`
      : `${BASE_URL}${ENDPOINTS.problemSubmit(options.oj ?? '', options.probNum ?? '')}`;

    const form: Record<string, string> = {
      method: '0',
      language: options.language,
      open: options.openSource === false ? '0' : '1',
      source: options.source,
    };
    if (inContest) {
      form.accessCode = options.accessCode ?? '';
      if (options.version) {
        form.version = options.version;
      }
    }

    logger.info(`submit -> ${url} (language=${options.language}, ${options.source.length} bytes)`);

    const res = await this.http.postForm(url, form, { Referer: links.contest(options.contestId ?? '') });
    await this.session.persistCookies();
    this.guardLogin(res.url, res.body);

    const body = res.body.trim();
    logger.info(`submit response: ${body.slice(0, 400)}`);

    const json = tryParseJson(body);
    if (json) {
      const runId = json.runId ?? json.id;
      if (runId !== undefined && runId !== null) {
        return { ok: true, runId: runId as string | number, message: '提交成功', raw: body };
      }
      if (json.challenge) {
        return {
          ok: false,
          needChallenge: true,
          message: 'Vjudge 要求完成人机验证（Cloudflare Turnstile），无法在后台直接提交。',
          raw: body,
        };
      }
      const error = json.error ?? json.message;
      if (error) {
        return { ok: false, message: extractMessage(String(error)) ?? String(error), raw: body };
      }
      if (json.success) {
        return { ok: true, message: '提交成功', raw: body };
      }
    }

    if (/login/i.test(body) && /password/i.test(body)) {
      throw new NotLoggedInError('提交被重定向到登录页，请重新登录。');
    }

    return { ok: false, message: 'Vjudge 返回了无法识别的内容，请查看输出面板。', raw: body };
  }

  /* ---------------- 内部 ---------------- */

  private guardLogin(finalUrl: string, body: string): void {
    if (finalUrl.includes('login=1') || (body.length < 2000 && /\/user\/login/.test(body))) {
      throw new NotLoggedInError();
    }
  }
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
  if (!text.startsWith('{') && !text.startsWith('[')) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Vjudge 的错误有时是 HTML 片段，这里取纯文本 */
function extractMessage(body: string): string | undefined {
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 300) : undefined;
}
