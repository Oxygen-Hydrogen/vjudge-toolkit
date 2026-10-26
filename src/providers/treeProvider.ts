import * as vscode from 'vscode';
import { ContestProblem } from '../client/parsers';
import { ArticleRecord, ContestRecord, ProblemRecord, Store } from '../store';

export type TreeNode = GroupNode | ContestNode | ContestProblemNode | ProblemNode | ArticleNode;

export interface GroupNode {
  type: 'group';
  group: 'contest' | 'problem' | 'article';
}

export interface ContestNode {
  type: 'contest';
  record: ContestRecord;
}

export interface ContestProblemNode {
  type: 'contestProblem';
  contestId: string;
  problem: ContestProblem;
}

export interface ProblemNode {
  type: 'problem';
  record: ProblemRecord;
}

export interface ArticleNode {
  type: 'article';
  record: ArticleRecord;
}

const GROUP_META = {
  contest: { label: '比赛', icon: 'trophy', empty: '还没有打开过比赛' },
  problem: { label: '题目', icon: 'file-code', empty: '还没有打开过题目' },
  article: { label: '文章', icon: 'book', empty: '还没有打开过文章' },
} as const;

export class VjudgeTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changed = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: Store) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.type) {
      case 'group': {
        const meta = GROUP_META[node.group];
        const count = this.countOf(node.group);
        const item = new vscode.TreeItem(meta.label, vscode.TreeItemCollapsibleState.Expanded);
        item.description = count > 0 ? String(count) : meta.empty;
        item.iconPath = new vscode.ThemeIcon(meta.icon);
        item.contextValue = 'vjudge.group';
        return item;
      }
      case 'contest': {
        const item = new vscode.TreeItem(node.record.title, vscode.TreeItemCollapsibleState.Collapsed);
        const { begin, end } = node.record;
        item.description = [formatRange(begin, end), `${node.record.problems.length} 题`]
          .filter(Boolean)
          .join(' · ');
        item.tooltip = new vscode.MarkdownString(
          `**${node.record.title}**\n\n- 比赛 ID：${node.record.id}\n- 时间：${formatRange(begin, end) || '未知'}\n- 题目数：${node.record.problems.length}`
        );
        item.iconPath = new vscode.ThemeIcon(isRunning(begin, end) ? 'debug-start' : 'trophy');
        item.contextValue = 'vjudge.contest';
        item.command = {
          command: 'vjudge.openContestById',
          title: '打开比赛',
          arguments: [node.record.id],
        };
        return item;
      }
      case 'contestProblem': {
        const label = node.problem.num ? `${node.problem.num} - ${node.problem.title}` : node.problem.title;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.description = node.problem.key;
        item.tooltip = `${node.problem.key}\n${node.problem.title}`;
        item.iconPath = new vscode.ThemeIcon('symbol-field');
        item.contextValue = 'vjudge.contestProblem';
        item.command = {
          command: 'vjudge.openContestProblem',
          title: '打开题目',
          arguments: [node.contestId, node.problem.num, node.problem.key],
        };
        return item;
      }
      case 'problem': {
        const item = new vscode.TreeItem(node.record.title || node.record.key, vscode.TreeItemCollapsibleState.None);
        item.description = node.record.key;
        item.tooltip = `${node.record.key}\n${node.record.title}`;
        item.iconPath = new vscode.ThemeIcon('file-code');
        item.contextValue = 'vjudge.problem';
        item.command = {
          command: 'vjudge.openProblemByKey',
          title: '打开题目',
          arguments: [node.record.key],
        };
        return item;
      }
      case 'article': {
        const item = new vscode.TreeItem(node.record.title, vscode.TreeItemCollapsibleState.None);
        item.description = `#${node.record.id}`;
        item.iconPath = new vscode.ThemeIcon('book');
        item.contextValue = 'vjudge.article';
        item.command = {
          command: 'vjudge.openArticleById',
          title: '打开文章',
          arguments: [node.record.id],
        };
        return item;
      }
    }
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return [
        { type: 'group', group: 'contest' },
        { type: 'group', group: 'problem' },
        { type: 'group', group: 'article' },
      ];
    }
    if (node.type === 'group') {
      switch (node.group) {
        case 'contest':
          return this.store.contests.map((record) => ({ type: 'contest', record }));
        case 'problem':
          return this.store.problems.map((record) => ({ type: 'problem', record }));
        case 'article':
          return this.store.articles.map((record) => ({ type: 'article', record }));
      }
    }
    if (node.type === 'contest') {
      return node.record.problems.map((problem) => ({
        type: 'contestProblem',
        contestId: node.record.id,
        problem,
      }));
    }
    return [];
  }

  private countOf(group: 'contest' | 'problem' | 'article'): number {
    switch (group) {
      case 'contest':
        return this.store.contests.length;
      case 'problem':
        return this.store.problems.length;
      case 'article':
        return this.store.articles.length;
    }
  }
}

function isRunning(begin?: number, end?: number): boolean {
  if (!begin || !end) {
    return false;
  }
  const now = Date.now();
  return now >= begin && now <= end;
}

export function formatRange(begin?: number, end?: number): string {
  if (!begin || !end) {
    return '';
  }
  return `${formatTime(begin)} ~ ${formatTime(end)}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
