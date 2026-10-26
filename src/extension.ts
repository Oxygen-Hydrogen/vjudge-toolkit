import * as vscode from 'vscode';
import { App } from './app';
import { registerCommands } from './commands';
import { VIEW_ID } from './constants';
import { logger } from './utils/logger';

let app: App | undefined;

export function activate(context: vscode.ExtensionContext): void {
  app = new App(context);
  context.subscriptions.push(app);

  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: app.tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  registerCommands(context, app);
  logger.info('Vjudge Toolkit 已激活');
}

export function deactivate(): void {
  app = undefined;
}
