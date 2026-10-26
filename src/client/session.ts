import * as vscode from 'vscode';
import { CookieJar } from './cookieJar';

const KEY_COOKIES = 'vjudge.cookies';
const KEY_USERNAME = 'vjudge.username';
const SECRET_PASSWORD = 'vjudge.password';

/** 负责 cookie / 用户名 / 密码的持久化 */
export class Session {
  readonly jar: CookieJar;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.jar = new CookieJar(context.globalState.get<Record<string, string>>(KEY_COOKIES) ?? {});
  }

  get username(): string | undefined {
    return this.context.globalState.get<string>(KEY_USERNAME);
  }

  get hasCookies(): boolean {
    return this.jar.size > 0;
  }

  async persistCookies(): Promise<void> {
    await this.context.globalState.update(KEY_COOKIES, this.jar.toJSON());
  }

  async setUsername(username: string | undefined): Promise<void> {
    await this.context.globalState.update(KEY_USERNAME, username);
  }

  async savePassword(password: string): Promise<void> {
    await this.context.secrets.store(SECRET_PASSWORD, password);
  }

  async getPassword(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_PASSWORD);
  }

  async clearPassword(): Promise<void> {
    await this.context.secrets.delete(SECRET_PASSWORD);
  }

  async clear(): Promise<void> {
    this.jar.clear();
    await this.persistCookies();
    await this.setUsername(undefined);
    await this.clearPassword();
  }
}
