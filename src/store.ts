import * as vscode from 'vscode';
import { ContestProblem } from './client/parsers';
import { getSettings } from './utils/config';

export interface ContestRecord {
  id: string;
  title: string;
  begin?: number;
  end?: number;
  version?: string;
  problems: ContestProblem[];
  addedAt: number;
}

export interface ProblemRecord {
  key: string;
  title: string;
  addedAt: number;
}

export interface ArticleRecord {
  id: string;
  title: string;
  addedAt: number;
}

const KEY_CONTESTS = 'vjudge.contests';
const KEY_PROBLEMS = 'vjudge.problems';
const KEY_ARTICLES = 'vjudge.articles';

/** 侧边栏保存的“最近打开”记录 */
export class Store {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get contests(): ContestRecord[] {
    return this.context.globalState.get<ContestRecord[]>(KEY_CONTESTS) ?? [];
  }

  get problems(): ProblemRecord[] {
    return this.context.globalState.get<ProblemRecord[]>(KEY_PROBLEMS) ?? [];
  }

  get articles(): ArticleRecord[] {
    return this.context.globalState.get<ArticleRecord[]>(KEY_ARTICLES) ?? [];
  }

  async addContest(record: ContestRecord): Promise<void> {
    const rest = this.contests.filter((item) => item.id !== record.id);
    await this.save(KEY_CONTESTS, [record, ...rest]);
  }

  async addProblem(record: ProblemRecord): Promise<void> {
    const rest = this.problems.filter((item) => item.key !== record.key);
    await this.save(KEY_PROBLEMS, [record, ...rest]);
  }

  async addArticle(record: ArticleRecord): Promise<void> {
    const rest = this.articles.filter((item) => item.id !== record.id);
    await this.save(KEY_ARTICLES, [record, ...rest]);
  }

  async removeContest(id: string): Promise<void> {
    await this.save(KEY_CONTESTS, this.contests.filter((item) => item.id !== id));
  }

  async removeProblem(key: string): Promise<void> {
    await this.save(KEY_PROBLEMS, this.problems.filter((item) => item.key !== key));
  }

  async removeArticle(id: string): Promise<void> {
    await this.save(KEY_ARTICLES, this.articles.filter((item) => item.id !== id));
  }

  async clear(): Promise<void> {
    await Promise.all([this.save(KEY_CONTESTS, []), this.save(KEY_PROBLEMS, []), this.save(KEY_ARTICLES, [])]);
  }

  private async save(key: string, list: unknown[]): Promise<void> {
    const max = getSettings().maxItemsPerGroup;
    await this.context.globalState.update(key, list.slice(0, max));
    this.changed.fire();
  }
}
