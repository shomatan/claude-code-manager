/**
 * ttyd Instance Manager
 *
 * tmuxセッションへのWebターミナルアクセスを提供するttydプロセスを管理する。
 * 各ttydインスタンスは1つのtmuxセッションを担当する。
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface TtydInstance {
  sessionId: string;
  port: number;
  process: ChildProcess;
  tmuxSessionName: string;
  startedAt: Date;
}

export class TtydManager extends EventEmitter {
  private instances: Map<string, TtydInstance> = new Map();
  private nextPort: number;
  private readonly MAX_PORT: number;

  constructor(startPort = 7680, maxPort = 7780) {
    super();
    this.nextPort = startPort;
    this.MAX_PORT = maxPort;
    this.checkTtydInstalled();
  }

  /**
   * ttydがインストールされているか確認
   */
  private checkTtydInstalled(): void {
    try {
      execSync("which ttyd", { stdio: "pipe" });
    } catch {
      console.warn(
        "[TtydManager] ttyd not found. Install it:\n" +
          "  macOS: brew install ttyd\n" +
          "  Ubuntu: apt install ttyd\n" +
          "  Or from: https://github.com/tsl0922/ttyd"
      );
    }
  }

  /**
   * 利用可能なポートを探す
   */
  private findAvailablePort(): number {
    const usedPorts = new Set(
      Array.from(this.instances.values()).map((i) => i.port)
    );

    for (let port = this.nextPort; port <= this.MAX_PORT; port++) {
      if (!usedPorts.has(port)) {
        this.nextPort = port + 1;
        if (this.nextPort > this.MAX_PORT) {
          this.nextPort = 7680; // ラップアラウンド
        }
        return port;
      }
    }
    throw new Error("No available ports for ttyd");
  }

  /**
   * tmuxセッション用のttydインスタンスを起動
   */
  async startInstance(
    sessionId: string,
    tmuxSessionName: string
  ): Promise<TtydInstance> {
    // 既存インスタンスがあれば返す
    const existing = this.instances.get(sessionId);
    if (existing) {
      return existing;
    }

    const port = this.findAvailablePort();

    // ttydオプション:
    // -W: クライアント入力を許可
    // -p: ポート番号
    // -t: ターミナルオプション（テーマ設定）
    // -b: バインドアドレス（127.0.0.1でローカルのみ）
    const ttydProcess = spawn(
      "ttyd",
      [
        "-W", // Writable
        "-p",
        port.toString(),
        "-i",
        "lo0", // macOS loopback interface
        "-t",
        "fontSize=14",
        "-t",
        "fontFamily=JetBrains Mono, Menlo, Monaco, monospace",
        "-t",
        "theme={\"background\":\"#1a1b26\",\"foreground\":\"#a9b1d6\"}",
        "tmux",
        "attach-session",
        "-t",
        tmuxSessionName,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      }
    );

    const instance: TtydInstance = {
      sessionId,
      port,
      process: ttydProcess,
      tmuxSessionName,
      startedAt: new Date(),
    };

    // ttydの起動を待つ
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("ttyd startup timeout"));
      }, 5000);

      let stderr = "";

      ttydProcess.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
        // ttydは "Listening on port XXXX" を出力する
        if (stderr.includes("Listening")) {
          clearTimeout(timeout);
          resolve();
        }
      });

      ttydProcess.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      ttydProcess.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`ttyd exited with code ${code}: ${stderr}`));
        }
      });
    });

    this.instances.set(sessionId, instance);
    this.emit("instance:started", instance);

    console.log(
      `[TtydManager] Started ttyd for ${tmuxSessionName} on port ${port}`
    );

    // プロセス終了時の処理
    ttydProcess.on("exit", (code) => {
      console.log(
        `[TtydManager] ttyd for session ${sessionId} exited with code ${code}`
      );
      this.instances.delete(sessionId);
      this.emit("instance:stopped", sessionId);
    });

    return instance;
  }

  /**
   * ttydインスタンスを停止
   */
  stopInstance(sessionId: string): void {
    const instance = this.instances.get(sessionId);
    if (!instance) return;

    instance.process.kill("SIGTERM");
    this.instances.delete(sessionId);
    this.emit("instance:stopped", sessionId);

    console.log(`[TtydManager] Stopped ttyd for session ${sessionId}`);
  }

  /**
   * セッションIDでttydインスタンスを取得
   */
  getInstance(sessionId: string): TtydInstance | undefined {
    return this.instances.get(sessionId);
  }

  /**
   * 全インスタンスを取得
   */
  getAllInstances(): TtydInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * 全インスタンスを停止
   */
  cleanup(): void {
    for (const instance of Array.from(this.instances.values())) {
      instance.process.kill("SIGTERM");
    }
    this.instances.clear();
    console.log("[TtydManager] Cleaned up all ttyd instances");
  }
}

export const ttydManager = new TtydManager();
