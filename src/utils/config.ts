import * as vscode from 'vscode';
import { BASE_URL, DEFAULT_USER_AGENT } from '../constants';

export type OpenMode = 'webview' | 'browser' | 'simpleBrowser';

export interface Settings {
  openMode: OpenMode;
  requestTimeout: number;
  maxItemsPerGroup: number;
  languageId: string;
  openSource: boolean;
  copyOnFallback: boolean;
  baseUrl: string;
  userAgent: string;
}

export function getSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration('vjudge');
  const mode = cfg.get<string>('openMode', 'webview');
  return {
    openMode: mode === 'browser' || mode === 'simpleBrowser' ? mode : 'webview',
    requestTimeout: Math.max(3000, cfg.get<number>('requestTimeout', 20000)),
    maxItemsPerGroup: Math.max(5, cfg.get<number>('maxItemsPerGroup', 30)),
    languageId: (cfg.get<string>('languageId', '') || '').trim(),
    openSource: cfg.get<boolean>('openSource', true),
    copyOnFallback: cfg.get<boolean>('copyOnFallback', true),
    baseUrl: BASE_URL,
    userAgent: DEFAULT_USER_AGENT,
  };
}
