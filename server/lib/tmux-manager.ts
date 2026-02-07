/**
 * tmux Session Manager
 *
 * tmuxセッションでclaude-codeインスタンスを管理する。
 * 各セッションはattach/detach可能で、サーバー再起動後も維持される。
 */

import { execSync, exec } from "node:child_process";
import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type { SpecialKey } from "../../shared/types.js";

export interface TmuxSession {
  id: string;
  tmuxSessionName: string;
  worktreePath: string;
  createdAt: Date;
  lastActivity: Date;
  status: "starting" | "running" | "stopped" | "error";
}

export class TmuxManager extends EventEmitter {
  private sessions: Map<string, TmuxSession> = new Map();
  private readonly SESSION_PREFIX = "ccm-";

  constructor() {
    super();
    this.checkTmuxInstalled();
    this.discoverExistingSessions();
  }

  /**
   * tmuxがインストールされているか確認
   */
  private checkTmuxInstalled(): void {
    try {
      execSync("which tmux", { stdio: "pipe" });
    } catch {
      console.error(
        "[TmuxManager] tmux not found. Install it:\n" +
          "  macOS: brew install tmux\n" +
          "  Ubuntu: apt install tmux"
      );
    }
  }

  /**
   * 既存のtmuxセッションを検出（前回の実行から残っているもの）
   */
  private discoverExistingSessions(): void {
    try {
      const output = execSync('tmux list-sessions -F "#{session_name}"', {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const sessionNames = output.trim().split("\n").filter(Boolean);

      for (const name of sessionNames) {
        if (name.startsWith(this.SESSION_PREFIX)) {
          const id = name.replace(this.SESSION_PREFIX, "");
          const cwd = this.getTmuxSessionCwd(name);

          // 既存セッションにもマウスモードを有効にする
          try {
            execSync(`tmux set-option -t "${name}" mouse on`, { stdio: "pipe" });
          } catch {
            // 設定に失敗しても続行
          }

          this.sessions.set(id, {
            id,
            tmuxSessionName: name,
            worktreePath: cwd || "",
            createdAt: new Date(),
            lastActivity: new Date(),
            status: "running",
          });

          console.log(`[TmuxManager] Discovered existing session: ${name}`);
        }
      }
    } catch {
      // tmuxセッションが存在しない場合
    }
  }

  /**
   * tmuxセッションの作業ディレクトリを取得
   */
  private getTmuxSessionCwd(sessionName: string): string | null {
    try {
      return execSync(
        `tmux display-message -p -t "${sessionName}" "#{pane_current_path}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
    } catch {
      return null;
    }
  }

  /**
   * 新しいtmuxセッションを作成してclaude-codeを起動
   */
  async createSession(worktreePath: string): Promise<TmuxSession> {
    const id = nanoid(8);
    const tmuxSessionName = `${this.SESSION_PREFIX}${id}`;

    try {
      // tmuxセッションを作成（detached mode）- シェルだけを起動
      execSync(
        `tmux new-session -d -s "${tmuxSessionName}" -c "${worktreePath}"`,
        { stdio: "pipe" }
      );
      // claudeコマンドを送信（終了後もシェルが残るのでvimなども使える）
      execSync(
        `tmux send-keys -t "${tmuxSessionName}" "claude --dangerously-skip-permissions" Enter`,
        { stdio: "pipe" }
      );
      // マウスモードを有効にしてスクロールを可能にする
      execSync(
        `tmux set-option -t "${tmuxSessionName}" mouse on`,
        { stdio: "pipe" }
      );
    } catch (error) {
      throw new Error(`Failed to create tmux session: ${error}`);
    }

    const session: TmuxSession = {
      id,
      tmuxSessionName,
      worktreePath,
      createdAt: new Date(),
      lastActivity: new Date(),
      status: "running",
    };

    this.sessions.set(id, session);
    this.emit("session:created", session);

    console.log(`[TmuxManager] Created session: ${tmuxSessionName} at ${worktreePath}`);

    return session;
  }

  /**
   * tmuxセッションにキー入力を送信
   */
  sendKeys(sessionId: string, input: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    // エスケープ処理: シングルクォートとバックスラッシュを適切に処理
    const escapedInput = input
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "'\\''");

    // send-keys -l でリテラル送信
    execSync(
      `tmux send-keys -t "${session.tmuxSessionName}" -l '${escapedInput}'`,
      { stdio: "pipe" }
    );

    // Enterキーを別途送信
    execSync(`tmux send-keys -t "${session.tmuxSessionName}" Enter`, {
      stdio: "pipe",
    });

    session.lastActivity = new Date();
  }

  /**
   * 特殊キーを送信 (Enter, Ctrl+C, Ctrl+D など)
   */
  sendSpecialKey(sessionId: string, key: SpecialKey): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    // S-Tab はtmuxでは "BTab" として送信
    const tmuxKey = key === "S-Tab" ? "BTab" : key;
    execSync(`tmux send-keys -t "${session.tmuxSessionName}" ${tmuxKey}`, {
      stdio: "pipe",
    });

    session.lastActivity = new Date();
  }

  /**
   * tmuxセッションが存在するか確認
   */
  sessionExists(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    try {
      execSync(`tmux has-session -t "${session.tmuxSessionName}"`, {
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * tmuxセッションを終了
   */
  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      execSync(`tmux kill-session -t "${session.tmuxSessionName}"`, {
        stdio: "pipe",
      });
      console.log(`[TmuxManager] Killed session: ${session.tmuxSessionName}`);
    } catch {
      // セッションが既に終了している場合
    }

    session.status = "stopped";
    this.sessions.delete(sessionId);
    this.emit("session:stopped", sessionId);
  }

  /**
   * IDでセッションを取得
   */
  getSession(sessionId: string): TmuxSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * worktreeパスでセッションを取得
   */
  getSessionByWorktree(worktreePath: string): TmuxSession | undefined {
    for (const session of Array.from(this.sessions.values())) {
      if (session.worktreePath === worktreePath) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * 全セッションを取得
   */
  getAllSessions(): TmuxSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 全セッションをクリーンアップ（サーバー終了時は呼ばない - セッション永続化のため）
   */
  cleanup(): void {
    for (const session of Array.from(this.sessions.values())) {
      this.killSession(session.id);
    }
  }
}

export const tmuxManager = new TmuxManager();
