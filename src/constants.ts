/** Vjudge 站点根地址 */
export const BASE_URL = 'https://vjudge.net';

/** 默认 UA，Vjudge 对空 UA 会返回异常页面 */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** 常量集中管理，方便 Vjudge 改版后统一调整 */
export const ENDPOINTS = {
  login: '/user/login',
  logout: '/user/logout',
  loginStatus: '/user/checkLogInStatus',
  article: (id: string) => `/article/${id}`,
  contest: (id: string) => `/contest/${id}`,
  contestSubmit: (contestId: string, num: string) => `/contest/submit/${contestId}/${num}`,
  problem: (key: string) => `/problem/${key}`,
  problemSubmit: (oj: string, num: string) => `/problem/submit/${oj}-${num}`,
} as const;

/** 拼接可直接在浏览器打开的链接 */
export const links = {
  problem: (key: string) => `${BASE_URL}/problem/${key}`,
  contest: (id: string) => `${BASE_URL}/contest/${id}`,
  contestProblem: (id: string, num: string) => `${BASE_URL}/contest/${id}#problem/${num}`,
  contestSubmit: (id: string, num: string) => `${BASE_URL}/contest/${id}#problem/${num}`,
  article: (id: string) => `${BASE_URL}/article/${id}`,
  status: () => `${BASE_URL}/status`,
} as const;

export const VIEW_ID = 'vjudge-explorer';
