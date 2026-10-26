import * as vscode from 'vscode';
import { App } from './app';
import { links } from './constants';
import { TreeNode } from './providers/treeProvider';

export function registerCommands(context: vscode.ExtensionContext, app: App): void {
  const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register('vjudge.login', () => app.login(true));
  register('vjudge.loginWithCookie', () => app.loginWithCookie());
  register('vjudge.logout', () => app.logout());
  register('vjudge.status', () => app.showStatus());

  register('vjudge.openContest', async () => {
    const input = await prompt('打开比赛', '比赛 ID 或链接，例如 500000 或 https://vjudge.net/contest/500000');
    if (input) {
      await app.openAnything(input, 'contest');
    }
  });

  register('vjudge.openProblem', async () => {
    const input = await prompt('打开题目', '题目 ID 或链接，例如 CodeForces-1A 或 https://vjudge.net/problem/CodeForces-1A');
    if (input) {
      await app.openAnything(input, 'problem');
    }
  });

  register('vjudge.openArticle', async () => {
    const input = await prompt('打开文章', '文章 ID 或链接，例如 1 或 https://vjudge.net/article/1');
    if (input) {
      await app.openAnything(input, 'article');
    }
  });

  register('vjudge.openLink', async () => {
    const input = await prompt('打开链接', '粘贴任意 vjudge 链接、比赛 ID、题目 ID 或文章 ID');
    if (input) {
      await app.openAnything(input, 'problem');
    }
  });

  // 供侧边栏内部调用
  register('vjudge.openContestById', (contestId) => app.openContest(String(contestId)));
  register('vjudge.openProblemByKey', (key) => app.openProblemByKey(String(key)));
  register('vjudge.openArticleById', (articleId) => app.openArticle(String(articleId)));
  register('vjudge.openContestProblem', (contestId, num, key) =>
    app.openContestProblem(String(contestId), String(num ?? ''), String(key))
  );

  register('vjudge.submit', async (arg) => {
    const node = asNode(arg);
    if (node?.type === 'contestProblem') {
      await app.beginSubmit({ key: node.problem.key, contestId: node.contestId, contestNum: node.problem.num });
      return;
    }
    if (node?.type === 'problem') {
      await app.beginSubmit({ key: node.record.key });
      return;
    }
    await app.submitActiveFile();
  });

  register('vjudge.submitActiveFile', () => app.submitActiveFile());

  register('vjudge.copyProblemLink', async (arg) => {
    const node = asNode(arg);
    if (node?.type === 'contestProblem') {
      await vscode.env.clipboard.writeText(links.contestProblem(node.contestId, node.problem.num));
      vscode.window.setStatusBarMessage('已复制比赛题目链接', 3000);
      return;
    }
    if (node?.type === 'problem') {
      await app.copyProblemLink(node.record.key);
      return;
    }
    if (node?.type === 'contest') {
      await vscode.env.clipboard.writeText(links.contest(node.record.id));
      vscode.window.setStatusBarMessage('已复制比赛链接', 3000);
      return;
    }
    if (node?.type === 'article') {
      await vscode.env.clipboard.writeText(links.article(node.record.id));
      vscode.window.setStatusBarMessage('已复制文章链接', 3000);
      return;
    }
    const input = await prompt('复制题目链接', '题目 ID，例如 CodeForces-1A');
    if (input) {
      await app.copyProblemLink(input.trim());
    }
  });

  register('vjudge.copySubmitLink', async (arg) => {
    const node = asNode(arg);
    if (node?.type === 'contestProblem') {
      await app.copySubmitLink(node.problem.key, node.contestId, node.problem.num);
      return;
    }
    if (node?.type === 'problem') {
      await app.copySubmitLink(node.record.key);
      return;
    }
    const input = await prompt('复制提交链接', '题目 ID，例如 CodeForces-1A');
    if (input) {
      await app.copySubmitLink(input.trim());
    }
  });

  register('vjudge.openInBrowser', async (arg) => {
    const node = asNode(arg);
    const url = urlOfNode(node);
    if (!url) {
      const input = await prompt('在浏览器打开', '任意 vjudge 链接');
      if (input) {
        await app.openExternally(input.trim());
      }
      return;
    }
    await app.openExternally(url);
  });

  register('vjudge.refresh', () => app.tree.refresh());

  register('vjudge.removeItem', async (arg) => {
    const node = asNode(arg);
    if (!node) {
      return;
    }
    if (node.type === 'contest') {
      await app.store.removeContest(node.record.id);
    } else if (node.type === 'problem') {
      await app.store.removeProblem(node.record.key);
    } else if (node.type === 'article') {
      await app.store.removeArticle(node.record.id);
    }
  });

  register('vjudge.clearAll', async () => {
    const confirm = await vscode.window.showWarningMessage('清空侧边栏里保存的比赛 / 题目 / 文章记录？', { modal: true }, '清空');
    if (confirm === '清空') {
      await app.store.clear();
    }
  });

  register('vjudge.captureCurrent', () => app.captureCurrent());

  register('vjudge.showRawHtml', async () => {
    const input = await prompt('抓取原始 HTML', '要抓取的 vjudge 页面链接');
    if (input) {
      await app.showRawHtml(input.trim());
    }
  });
}

async function prompt(title: string, placeHolder: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({ title, prompt: placeHolder, placeHolder, ignoreFocusOut: true });
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function asNode(arg: unknown): TreeNode | undefined {
  if (!arg || typeof arg !== 'object' || !('type' in arg)) {
    return undefined;
  }
  const node = arg as TreeNode;
  return node.type === 'group' ? undefined : node;
}

function urlOfNode(node: TreeNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  switch (node.type) {
    case 'contest':
      return links.contest(node.record.id);
    case 'contestProblem':
      return links.problem(node.problem.key);
    case 'problem':
      return links.problem(node.record.key);
    case 'article':
      return links.article(node.record.id);
    default:
      return undefined;
  }
}
