import * as vscode from 'vscode';

class Logger {
  private channel: vscode.OutputChannel | undefined;

  private get out(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel('Vjudge');
    }
    return this.channel;
  }

  info(message: string): void {
    this.out.appendLine(`[${stamp()}] ${message}`);
  }

  warn(message: string): void {
    this.out.appendLine(`[${stamp()}] WARN ${message}`);
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : err ? String(err) : '';
    this.out.appendLine(`[${stamp()}] ERROR ${message}${detail ? `\n${detail}` : ''}`);
  }

  show(): void {
    this.out.show(true);
  }

  dispose(): void {
    this.channel?.dispose();
    this.channel = undefined;
  }
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const logger = new Logger();
