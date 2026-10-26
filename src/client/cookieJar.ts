/**
 * 极简 CookieJar：Vjudge 用 JSESSIONID 维持登录态，
 * 我们需要把 set-cookie 跨请求带回去，node 的 fetch 不会自动做这件事。
 */
export class CookieJar {
  private readonly store = new Map<string, string>();

  constructor(init?: Record<string, string>) {
    if (init) {
      for (const [k, v] of Object.entries(init)) {
        if (k && v) {
          this.store.set(k, v);
        }
      }
    }
  }

  get size(): number {
    return this.store.size;
  }

  has(name: string): boolean {
    return this.store.has(name);
  }

  get(name: string): string | undefined {
    return this.store.get(name);
  }

  set(name: string, value: string): void {
    if (name && value) {
      this.store.set(name, value);
    }
  }

  clear(): void {
    this.store.clear();
  }

  /** 生成请求头里的 Cookie 字段 */
  header(): string {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.store.entries());
  }

  /** 从响应头吸收 cookie */
  absorb(headers: Headers): void {
    const withGetter = headers as unknown as { getSetCookie?: () => string[] };
    const list: string[] =
      typeof withGetter.getSetCookie === 'function'
        ? withGetter.getSetCookie()
        : splitCombined(headers.get('set-cookie'));

    for (const raw of list) {
      const parsed = parseSetCookie(raw);
      if (!parsed) {
        continue;
      }
      if (parsed.expired) {
        this.store.delete(parsed.name);
      } else {
        this.store.set(parsed.name, parsed.value);
      }
    }
  }
}

/** 有些运行时会把多个 set-cookie 用 ", " 拼成一个字符串，这里做兜底拆分 */
function splitCombined(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value.split(/,(?=\s*[A-Za-z0-9_\-]+=)/g);
}

function parseSetCookie(raw: string): { name: string; value: string; expired: boolean } | undefined {
  const first = raw.split(';')[0]?.trim();
  if (!first) {
    return undefined;
  }
  const eq = first.indexOf('=');
  if (eq <= 0) {
    return undefined;
  }
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  const lower = raw.toLowerCase();
  const expired = /max-age\s*=\s*0\b/.test(lower) || /expires\s*=\s*thu, 01 jan 1970/.test(lower);
  return { name, value, expired };
}
