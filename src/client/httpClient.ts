import { CookieJar } from './cookieJar';
import { logger } from '../utils/logger';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message?: string
  ) {
    super(message ?? `HTTP ${status} ${url}`);
    this.name = 'HttpError';
  }
}

export interface HttpResponse {
  status: number;
  url: string;
  headers: Headers;
  body: string;
}

export class HttpClient {
  constructor(
    private readonly jar: CookieJar,
    private readonly userAgent: string,
    private readonly timeoutMs: number,
    private readonly baseUrl: string
  ) {}

  get(url: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
    return this.send('GET', url, undefined, headers);
  }

  getJson<T>(url: string): Promise<T> {
    return this.get(url, {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    }).then((res) => JSON.parse(res.body) as T);
  }

  postForm(url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<HttpResponse> {
    return this.send('POST', url, new URLSearchParams(form).toString(), {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      ...headers,
    });
  }

  private async send(
    method: string,
    url: string,
    body: string | undefined,
    headers: Record<string, string>,
    redirects = 0
  ): Promise<HttpResponse> {
    if (redirects > 6) {
      throw new HttpError(310, url, '重定向次数过多');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const cookie = this.jar.header();
      const res = await fetch(url, {
        method,
        body,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: `${this.baseUrl}/`,
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
      });

      this.jar.absorb(res.headers);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          throw new HttpError(res.status, url, `重定向缺少 Location（${res.status}）`);
        }
        const next = new URL(location, url).toString();
        const keepBody = res.status === 307 || res.status === 308;
        logger.info(`redirect ${res.status} ${url} -> ${next}`);
        return this.send(keepBody ? method : 'GET', next, keepBody ? body : undefined, headers, redirects + 1);
      }

      const buffer = await res.arrayBuffer();
      const text = new TextDecoder('utf-8').decode(buffer);
      logger.info(`${method} ${res.status} ${url} (${text.length} bytes)`);
      return { status: res.status, url, headers: res.headers, body: text };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`请求超时（${this.timeoutMs}ms）：${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
