import { parse, HTMLElement as ParsedElement } from 'node-html-parser';
import { links } from '../constants';

export interface ContestProblem {
  num: string;
  key: string;
  title: string;
}

export interface ContestInfo {
  id: string;
  title: string;
  url: string;
  begin?: number;
  end?: number;
  openness?: number;
  authStatus?: number;
  version?: string;
  problems: ContestProblem[];
  note?: string;
}

export interface ProblemInfo {
  key: string;
  oj: string;
  num: string;
  title: string;
  timeLimit?: string;
  memoryLimit?: string;
  statementHtml: string;
  languages: Record<string, string>;
  submitPath: string;
  url: string;
  note?: string;
}

export interface ArticleInfo {
  id: string;
  title: string;
  author?: string;
  createTime?: number;
  updateTime?: number;
  viewCnt?: number;
  likeCnt?: number;
  markdown: string;
  url: string;
  note?: string;
}

type Json = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

/** Vjudge 把页面数据序列化在 <textarea name="dataJson"> 里，优先读它 */
export function extractDataJson(html: string): Json | undefined {
  const match = html.match(/<textarea[^>]*name=["']dataJson["'][^>]*>([\s\S]*?)<\/textarea>/i);
  if (!match) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(match[1]);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Json) : undefined;
  } catch {
    return undefined;
  }
}

/** 在 JSON 里递归找第一个满足条件的值 */
export function deepFind(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 7 || value === null || typeof value !== 'object') {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = deepFind(item, keys, depth + 1);
      if (hit !== undefined) {
        return hit;
      }
    }
    return undefined;
  }
  const obj = value as Json;
  for (const key of keys) {
    if (key in obj && obj[key] !== null && obj[key] !== undefined && obj[key] !== '') {
      return obj[key];
    }
  }
  for (const v of Object.values(obj)) {
    const hit = deepFind(v, keys, depth + 1);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  const s = asString(value);
  if (!s) {
    return undefined;
  }
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** 把任意相对地址补全成 vjudge 上的绝对地址 */
export function absoluteUrl(url: string, base = 'https://vjudge.net'): string {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(javascript|data|mailto):/i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return trimmed;
  }
}

function parseHtml(html: string): ParsedElement {
  return parse(html, {
    lowerCaseTagName: true,
    comment: false,
    blockTextElements: { script: false, noscript: false, style: false, pre: true },
  });
}

function firstText(root: ParsedElement, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = el?.text.replace(/\s+/g, ' ').trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * 比赛
 * ------------------------------------------------------------------ */

export function parseContest(html: string, contestId: string): ContestInfo {
  const data = extractDataJson(html);
  const root = parseHtml(html);

  const title =
    asString(data?.title) ??
    firstText(root, ['meta[property="og:title"]', 'h1', 'h2', 'title']) ??
    `比赛 ${contestId}`;

  const meta = (data ?? {}) as Json;
  const problems = mergeProblems(collectProblemsFromJson(data), collectProblemsFromHtml(root));

  const info: ContestInfo = {
    id: asString(meta.id) ?? contestId,
    title,
    url: links.contest(contestId),
    begin: asNumber(meta.begin),
    end: asNumber(meta.end),
    openness: asNumber(meta.openness),
    authStatus: asNumber(meta.authStatus),
    version: asString(meta.version),
    problems,
  };

  if (problems.length === 0) {
    info.note =
      info.authStatus === 0 || info.authStatus === undefined
        ? 'Vjudge 只有在登录后才会下发比赛题目列表。请先用左侧 Vjudge 视图里的「登录」命令登录，再重新打开这场比赛。'
        : '没有从页面解析到题目列表。可能是你没有参加这场比赛、比赛尚未公开，或 Vjudge 改版了。可以点“在浏览器打开”查看原页面。';
  }
  return info;
}

function collectProblemsFromJson(data: Json | undefined): ContestProblem[] {
  if (!data) {
    return [];
  }
  const raw = deepFind(data, ['problems', 'problemList']);
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ContestProblem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const obj = item as Json;
    const oj = asString(obj.oj) ?? asString(obj.ojId) ?? '';
    const probNum = asString(obj.probNum) ?? asString(obj.pid) ?? asString(obj.probNumStr) ?? '';
    const key =
      asString(obj.key) ?? asString(obj.problemKey) ?? (oj && probNum ? `${oj}-${probNum}` : '');
    if (!key) {
      continue;
    }
    out.push({
      num: normalizeContestNum(asString(obj.num) ?? asString(obj.contestNum)),
      key,
      title: asString(obj.title) ?? key,
    });
  }
  return out;
}

function collectProblemsFromHtml(root: ParsedElement): ContestProblem[] {
  const out: ContestProblem[] = [];
  const seen = new Set<string>();

  const rowSelectors = [
    '#contest-problems tbody tr',
    '.contest-problems tbody tr',
    'table.problems tbody tr',
    'table tbody tr',
  ];
  for (const selector of rowSelectors) {
    for (const row of root.querySelectorAll(selector)) {
      const link = row.querySelector('a[href*="/problem/"]');
      const key = link ? problemKeyFromHref(link.getAttribute('href') ?? '') : undefined;
      if (!key || seen.has(key)) {
        continue;
      }
      const num =
        row.querySelector('td.prob-num')?.text.trim() ??
        row.querySelector('.prob-num')?.text.trim() ??
        letterFromHash(row.innerHTML) ??
        '';
      const title = cleanProblemTitle(link?.text ?? '', num) || key;
      seen.add(key);
      out.push({ num: num.toUpperCase(), key, title });
    }
    if (out.length > 0) {
      break;
    }
  }

  if (out.length > 0) {
    return sortProblems(out);
  }

  // 退路：直接扫描所有题目链接
  for (const anchor of root.querySelectorAll('a[href*="/problem/"]')) {
    const key = problemKeyFromHref(anchor.getAttribute('href') ?? '');
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const text = anchor.text.replace(/\s+/g, ' ').trim();
    out.push({ num: '', key, title: cleanProblemTitle(text, '') || key });
  }
  return sortProblems(out);
}

function problemKeyFromHref(href: string): string | undefined {
  const match = href.match(/\/problem\/([A-Za-z0-9_\-.%]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function letterFromHash(html: string): string | undefined {
  const match = html.match(/#problem\/([A-Za-z0-9]+)/);
  return match ? match[1].replace(/^0+/, '') : undefined;
}

function cleanProblemTitle(text: string, num: string): string {
  let title = text.replace(/\s+/g, ' ').trim();
  if (num) {
    const prefix = new RegExp(`^${escapeRegExp(num)}\\s*[-–—.:、]?\\s*`, 'i');
    title = title.replace(prefix, '');
  }
  return title.replace(/^[-–—.:、]\s*/, '').trim();
}

function mergeProblems(a: ContestProblem[], b: ContestProblem[]): ContestProblem[] {
  if (a.length === 0) {
    return sortProblems(b);
  }
  const byKey = new Map(a.map((p) => [p.key, p]));
  for (const item of b) {
    const exist = byKey.get(item.key);
    if (!exist) {
      byKey.set(item.key, item);
      continue;
    }
    if (!exist.num && item.num) {
      exist.num = item.num;
    }
    if ((!exist.title || exist.title === exist.key) && item.title) {
      exist.title = item.title;
    }
  }
  return sortProblems([...byKey.values()]);
}

function sortProblems(list: ContestProblem[]): ContestProblem[] {
  return list.sort((x, y) => {
    if (x.num && y.num) {
      return x.num.localeCompare(y.num, 'en', { numeric: true });
    }
    return x.key.localeCompare(y.key);
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Vjudge 比赛题号通常是字母；如果拿到 0/1/2 这样的下标就转成 A/B/C */
function normalizeContestNum(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed);
    if (index >= 0 && index < 26) {
      return String.fromCharCode(65 + index);
    }
  }
  return trimmed.toUpperCase();
}

/* ------------------------------------------------------------------ *
 * 题目
 * ------------------------------------------------------------------ */

export function parseProblem(html: string, oj: string, num: string): ProblemInfo {
  const key = `${oj}-${num}`;
  const data = extractDataJson(html);
  const root = parseHtml(html);

  const title =
    asString(data?.title) ??
    firstText(root, ['#prob-title', '.prob-title', 'h1', 'h2', 'meta[property="og:title"]']) ??
    key;

  const bodyText = root.text;
  const timeLimit =
    asString(deepFind(data, ['timeLimit', 'time_limit'])) ??
    bodyText.match(/Time\s*[Ll]imit\s*[:：]?\s*([\d.]+\s*m?s)/)?.[1];
  const memoryLimit =
    asString(deepFind(data, ['memoryLimit', 'memory_limit'])) ??
    bodyText.match(/Memory\s*[Ll]imit\s*[:：]?\s*([\d.]+\s*[KM]?B)/i)?.[1];

  const { html: statementHtml, note } = extractStatement(root, html);

  return {
    key,
    oj,
    num,
    title: title.replace(/\s+/g, ' ').trim(),
    timeLimit,
    memoryLimit,
    statementHtml,
    languages: extractLanguages(data, root),
    submitPath: `/problem/submit/${key}`,
    url: links.problem(key),
    note,
  };
}

function extractStatement(root: ParsedElement, rawHtml: string): { html: string; note?: string } {
  const selectors = [
    '#prob-content',
    '#problem-content',
    '.prob-content',
    '.problem-content',
    '#description',
    '.problem-desc',
    '.problem-statement',
    'article',
  ];

  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el && el.text.trim().length > 80) {
      return { html: sanitize(el.outerHTML) };
    }
  }

  // 有些比赛题解页面用 iframe 嵌入原站题面，无法直接渲染
  const iframe = root.querySelector('#frame-description-container iframe') ?? root.querySelector('iframe[src]');
  const iframeSrc = iframe?.getAttribute('src');
  if (iframeSrc) {
    return {
      html: '<p class="vj-empty">这道题的题面是通过 iframe 嵌入的外部页面，插件无法直接渲染。</p>',
      note: `题面来源：${absoluteUrl(iframeSrc)}`,
    };
  }

  const best = largestContentBlock(root);
  if (best) {
    return { html: sanitize(best.outerHTML), note: '未能精确定位题面容器，已展示页面中最大的内容区块。' };
  }

  return {
    html: '<p class="vj-empty">没有解析到题面内容。可以点“在浏览器打开”查看原页面。</p>',
    note: rawHtml.includes('login=1') ? '当前请求被重定向到登录页，请先登录。' : undefined,
  };
}

/** 兜底：找 text 最长的、含有段落/代码块的容器 */
function largestContentBlock(root: ParsedElement): ParsedElement | undefined {
  let best: ParsedElement | undefined;
  let bestLength = 0;
  for (const el of root.querySelectorAll('div, article, section, main')) {
    if (!el.querySelector('p, pre, ul, ol')) {
      continue;
    }
    const length = el.text.trim().length;
    if (length > bestLength) {
      best = el;
      bestLength = length;
    }
  }
  return bestLength > 200 ? best : undefined;
}

function extractLanguages(data: Json | undefined, root: ParsedElement): Record<string, string> {
  const out: Record<string, string> = {};

  const fromJson = deepFind(data, ['languages', 'langs', 'languageList']);
  if (fromJson && typeof fromJson === 'object' && !Array.isArray(fromJson)) {
    for (const [id, name] of Object.entries(fromJson as Json)) {
      const label = asString(name);
      if (/^\d+$/.test(id) && label) {
        out[id] = label;
      }
    }
  }

  if (Object.keys(out).length === 0) {
    for (const option of root.querySelectorAll('select[name="language"] option, select#language option')) {
      const value = option.getAttribute('value')?.trim();
      const label = option.text.trim();
      if (value && label) {
        out[value] = label;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 文章
 * ------------------------------------------------------------------ */

export function parseArticle(html: string, articleId: string): ArticleInfo {
  const data = extractDataJson(html);
  const root = parseHtml(html);

  const title =
    asString(data?.title) ?? firstText(root, ['h1', 'h2', 'meta[property="og:title"]']) ?? `文章 ${articleId}`;

  let markdown = asString(data?.content) ?? '';
  if (!markdown) {
    const el = root.querySelector('#article-container');
    markdown = el?.innerHTML.trim() ?? '';
  }

  return {
    id: asString(data?.id) ?? articleId,
    title: title.replace(/\s+/g, ' ').trim(),
    author: asString(data?.author),
    createTime: asNumber(data?.createTime),
    updateTime: asNumber(data?.updateTime),
    viewCnt: asNumber(data?.viewCnt),
    likeCnt: asNumber(data?.likeCnt),
    markdown: markdown.replace(/\r\n/g, '\n'),
    url: links.article(articleId),
    note: markdown ? undefined : '没有解析到文章正文，可能文章已删除或需要更高权限。',
  };
}

/* ------------------------------------------------------------------ *
 * HTML 清洗（供 webview 使用）
 * ------------------------------------------------------------------ */

const BLOCKED_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'meta',
  'base',
  'svg',
  'canvas',
  'video',
  'audio',
  'source',
]);

export function sanitize(html: string): string {
  if (!html.includes('<')) {
    return html;
  }
  let root: ParsedElement;
  try {
    root = parse(html, { lowerCaseTagName: true, comment: false });
  } catch {
    return escapeHtml(html);
  }

  for (const el of root.querySelectorAll('*')) {
    const tag = el.tagName?.toLowerCase() ?? '';
    if (BLOCKED_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    for (const attr of Object.keys(el.attributes)) {
      const lower = attr.toLowerCase();
      if (lower.startsWith('on') || lower === 'srcdoc' || lower === 'formaction' || lower === 'action') {
        el.removeAttribute(attr);
        continue;
      }
      if (lower === 'href' || lower === 'src' || lower === 'poster') {
        const value = el.getAttribute(attr) ?? '';
        if (/^javascript:/i.test(value)) {
          el.removeAttribute(attr);
        } else {
          el.setAttribute(attr, absoluteUrl(value));
        }
      }
    }
    if (tag === 'a') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }

  return root.innerHTML;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ *
 * 链接识别
 * ------------------------------------------------------------------ */

export type ParsedTarget =
  | { kind: 'contest'; contestId: string }
  | { kind: 'contestProblem'; contestId: string; num: string }
  | { kind: 'problem'; oj: string; num: string }
  | { kind: 'article'; articleId: string }
  | { kind: 'unknown' };

/** 支持：纯 ID、各种 vjudge 链接、CodeForces-1A 这种题目 key */
export function parseTarget(input: string, hint: 'contest' | 'problem' | 'article'): ParsedTarget {
  const text = input.trim();
  if (!text) {
    return { kind: 'unknown' };
  }

  const contestMatch = text.match(/vjudge\.net\/contest\/(\d+)(?:\/)?(?:#problem\/([^/\s?#]+))?/i);
  if (contestMatch) {
    if (contestMatch[2]) {
      return { kind: 'contestProblem', contestId: contestMatch[1], num: decodeURIComponent(contestMatch[2]) };
    }
    return { kind: 'contest', contestId: contestMatch[1] };
  }

  const localContest = text.match(/^contest\/(\d+)(?:#problem\/([^/\s?#]+))?$/i);
  if (localContest) {
    return localContest[2]
      ? { kind: 'contestProblem', contestId: localContest[1], num: localContest[2] }
      : { kind: 'contest', contestId: localContest[1] };
  }

  const problemMatch =
    text.match(/vjudge\.net\/problem\/([A-Za-z0-9_\-.%]+)/i) ?? text.match(/^problem\/([A-Za-z0-9_\-.%]+)$/i);
  if (problemMatch) {
    const key = decodeURIComponent(problemMatch[1]);
    const split = splitProblemKey(key);
    if (split) {
      return { kind: 'problem', oj: split.oj, num: split.num };
    }
  }

  const articleMatch = text.match(/vjudge\.net\/article\/(\d+)/i) ?? text.match(/^article\/(\d+)$/i);
  if (articleMatch) {
    return { kind: 'article', articleId: articleMatch[1] };
  }

  if (/^\d+$/.test(text)) {
    return hint === 'contest'
      ? { kind: 'contest', contestId: text }
      : hint === 'article'
        ? { kind: 'article', articleId: text }
        : { kind: 'unknown' };
  }

  const split = splitProblemKey(text);
  if (split) {
    return { kind: 'problem', oj: split.oj, num: split.num };
  }
  return { kind: 'unknown' };
}

/** "CodeForces-1234A" -> { oj: "CodeForces", num: "1234A" } */
export function splitProblemKey(key: string): { oj: string; num: string } | undefined {
  const match = key.match(/^([A-Za-z][A-Za-z0-9_]*)[-_](.+)$/);
  if (!match) {
    return undefined;
  }
  return { oj: match[1], num: match[2] };
}

/** 从代码首行注释里找 vjudge 链接（// https://vjudge.net/problem/xxx） */
export function findVjudgeUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/vjudge\.net\/(?:problem|contest|article)\/[^\s'"<>)]+/i);
  return match?.[0];
}
