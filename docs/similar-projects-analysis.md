# 類似プロジェクト実装詳細解説

## 1. sugyan/claude-code-webui

**GitHub:** https://github.com/sugyan/claude-code-webui
**Star:** 833 | **言語:** TypeScript (92%)

### アーキテクチャ

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │     │     Backend     │     │   Claude CLI    │
│   (React/Vite)  │────▶│   (Hono/Deno)   │────▶│  (@anthropic-ai │
│                 │ WS  │                 │ SDK │  /claude-code)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | React, Vite, TailwindCSS |
| Backend | Hono (Deno/Node.js両対応) |
| Claude通信 | `@anthropic-ai/claude-code` パッケージの `query()` 関数 |
| ストリーミング | NDJSON (Newline Delimited JSON) |

### Claude CLIとの通信方法

**重要:** このプロジェクトは `@anthropic-ai/claude-code` パッケージを使用しています。これは Agent SDK とは異なり、Claude Code CLI のラッパーです。

```typescript
// backend/handlers/chat.ts より抜粋
import { query, type PermissionMode } from "@anthropic-ai/claude-code";

async function* executeClaudeCommand(
  message: string,
  requestId: string,
  requestAbortControllers: Map<string, AbortController>,
  cliPath: string,
  sessionId?: string,
  allowedTools?: string[],
  workingDirectory?: string,
  permissionMode?: PermissionMode,
): AsyncGenerator<StreamResponse> {
  
  const abortController = new AbortController();
  requestAbortControllers.set(requestId, abortController);

  // query() 関数でClaude CLIを呼び出し
  for await (const sdkMessage of query({
    prompt: processedMessage,
    options: {
      abortController,
      executable: "node" as const,
      executableArgs: [],
      pathToClaudeCodeExecutable: cliPath,
      // セッション継続: resume オプションでセッションIDを指定
      ...(sessionId ? { resume: sessionId } : {}),
      ...(allowedTools ? { allowedTools } : {}),
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
      ...(permissionMode ? { permissionMode } : {}),
    },
  })) {
    yield {
      type: "claude_json",
      data: sdkMessage,
    };
  }
  
  yield { type: "done" };
}
```

### 会話継続の実装

- `resume: sessionId` オプションを使用
- セッションIDはClaude CLIが自動生成
- フロントエンドがセッションIDを保持し、次のリクエストで送信

### ストリーミング処理

```typescript
// ReadableStream でNDJSONをストリーミング
const stream = new ReadableStream({
  async start(controller) {
    for await (const chunk of executeClaudeCommand(...)) {
      const data = JSON.stringify(chunk) + "\n";
      controller.enqueue(new TextEncoder().encode(data));
    }
    controller.close();
  },
});

return new Response(stream, {
  headers: {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  },
});
```

### 特徴

1. **Deno/Node.js両対応**: ランタイム抽象化レイヤーを持つ
2. **CLIパス検出**: 自動検出 + 手動指定オプション
3. **中断機能**: AbortController でリクエストをキャンセル可能
4. **権限モード**: `permissionMode` で許可モードを切り替え

---

## 2. KyleAMathews/claude-code-ui

**GitHub:** https://github.com/KyleAMathews/claude-code-ui
**Star:** 280 | **言語:** TypeScript (71%)

### アーキテクチャ

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Code    │     │     Daemon      │     │       UI        │
│   Sessions      │────▶│   (Watcher)     │────▶│   (React)       │
│  ~/.claude/     │FS   │                 │ WS  │                 │
│   projects/     │     │  Durable Stream │     │  TanStack DB    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| Daemon | Node.js, chokidar (ファイル監視), XState (状態管理) |
| UI | React, TanStack Router, Radix UI |
| 同期 | Durable Streams (リアルタイム状態同期) |
| DB | TanStack DB (リアクティブDB) |

### 重要な違い

**このプロジェクトはClaude CLIを直接呼び出さない。** 代わりに、Claude Codeが生成するログファイルを監視して状態を推測する。

### ログファイル監視の実装

```typescript
// packages/daemon/src/watcher.ts より抜粋
import { watch, type FSWatcher } from "chokidar";

const CLAUDE_PROJECTS_DIR = `${process.env.HOME}/.claude/projects`;
const SIGNALS_DIR = `${process.env.HOME}/.claude/session-signals`;

export class SessionWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private sessions = new Map<string, SessionState>();

  async start(): Promise<void> {
    // ~/.claude/projects/ ディレクトリを監視
    this.watcher = watch(CLAUDE_PROJECTS_DIR, {
      ignored: /agent-.*\.jsonl$/,  // サブエージェントファイルは無視
      persistent: true,
      ignoreInitial: false,
      depth: 2,
    });

    this.watcher
      .on("add", (path) => {
        if (!path.endsWith(".jsonl")) return;
        this.handleFile(path, "add");
      })
      .on("change", (path) => {
        if (!path.endsWith(".jsonl")) return;
        this.debouncedHandleFile(path);
      })
      .on("unlink", (path) => this.handleDelete(path));

    // シグナルディレクトリも監視（フック出力）
    this.signalWatcher = watch(SIGNALS_DIR, {
      persistent: true,
      ignoreInitial: false,
      depth: 0,
    });
  }
}
```

### セッション状態の管理

```typescript
// XState状態マシンで状態を管理
export interface SessionState {
  sessionId: string;
  filepath: string;
  encodedDir: string;
  cwd: string;
  gitBranch: string | null;
  originalPrompt: string;
  startedAt: string;
  status: StatusResult;
  entries: LogEntry[];
  bytePosition: number;
  gitRepoUrl: string | null;
  gitRepoId: string | null;
  branchChanged?: boolean;
  pendingPermission?: PendingPermission;
  hasWorkingSignal?: boolean;
  hasStopSignal?: boolean;
  hasEndedSignal?: boolean;
}
```

### 状態推測ロジック

Claude Codeのフック機能を使用して正確な状態を検出：

1. **PermissionRequest フック**: ツール承認待ち
2. **UserPromptSubmit フック**: ユーザーがプロンプト送信
3. **Stop フック**: Claudeのターン終了
4. **SessionEnd フック**: セッション終了

```typescript
// 状態の決定ロジック
if (hasPendingPermission) {
  status = { status: "waiting", hasPendingToolUse: true };
} else if (hasStopSig) {
  status = { status: "waiting", hasPendingToolUse: false };
} else if (hasWorkingSig) {
  status = { status: "working", hasPendingToolUse: false };
}
```

### 特徴

1. **非侵入的**: Claude CLIを直接呼び出さず、ログを監視
2. **複数セッション対応**: 複数のClaude Codeセッションを同時監視
3. **Kanbanビュー**: Working, Needs Approval, Waiting, Idle でグループ化
4. **PR/CI追跡**: GitHubのPR状態とCI結果を表示
5. **AI要約**: Anthropic APIでセッション活動を要約

---

## 比較表

| 項目 | sugyan/claude-code-webui | KyleAMathews/claude-code-ui |
|------|--------------------------|----------------------------|
| **目的** | Claude Codeのウェブインターフェース | セッション監視ダッシュボード |
| **Claude通信** | `@anthropic-ai/claude-code` query() | ログファイル監視 |
| **会話継続** | `resume: sessionId` オプション | N/A（監視のみ） |
| **ストリーミング** | NDJSON over HTTP | Durable Streams |
| **状態管理** | フロントエンドで管理 | XState状態マシン |
| **複数セッション** | 1セッション/接続 | 全セッション監視 |
| **Agent SDK使用** | ❌ (claude-code パッケージ) | ❌ (ログ監視) |

---

## あなたのプロジェクトへの示唆

### sugyan/claude-code-webui から学べること

1. **`@anthropic-ai/claude-code` パッケージの使い方**
   - `query()` 関数でCLIを呼び出し
   - `resume` オプションで会話継続
   - AbortController で中断

2. **NDJSONストリーミング**
   - ReadableStream でチャンク送信
   - フロントエンドで逐次パース

### KyleAMathews/claude-code-ui から学べること

1. **ログファイル構造**
   - `~/.claude/projects/` にJSONLファイル
   - エントリ単位で状態を追跡

2. **フック機能**
   - `~/.claude/session-signals/` にシグナルファイル
   - 正確な状態検出に使用

---

## 3. yazinsai/claude-code-remote

**GitHub:** https://github.com/yazinsai/claude-code-remote
**言語:** JavaScript (47.9%), TypeScript (14.2%), CSS (25.7%), HTML (12.2%)

### アーキテクチャ

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │     │     Backend     │     │   Claude CLI    │
│   (Vanilla JS)  │────▶│   (Bun/Express) │────▶│     (PTY)       │
│     PWA         │ WS  │   WebSocket     │ PTY │   node-pty      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │
         │                      ├── session-manager.ts
         │                      ├── pty-session.ts
         │                      └── tunnel.ts (Cloudflare)
         │
         └── モバイル対応（QRコード接続）
```

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | Vanilla JavaScript, xterm.js, PWA |
| Backend | Bun, Express, WebSocket |
| Claude通信 | PTY (疑似ターミナル) で Claude CLI を直接起動 |
| リモートアクセス | Cloudflare Tunnel |
| ターミナル | node-pty, xterm.js |

### 重要な違い

**このプロジェクトは Claude CLI バイナリを PTY で直接起動する。** SDK や API ではなく、ターミナルエミュレーションでフルターミナルアクセスを提供。

### PTYセッション管理の実装

```typescript
// server/pty-session.ts より抜粋
import { IPty, spawn } from "node-pty";

export class PtySession extends EventEmitter {
  private pty: IPty | null = null;
  private outputHistory = "";
  private static readonly MAX_HISTORY_SIZE = 100_000;

  constructor(
    public readonly id: string,
    public readonly cwd: string
  ) {
    super();
  }

  // Claude CLIバイナリの検出（3段階）
  private async findClaudePath(): Promise<string | null> {
    // 1. 環境変数 CLAUDE_PATH
    if (process.env.CLAUDE_PATH) return process.env.CLAUDE_PATH;

    // 2. which claude でシステムPATHから検索
    const whichResult = await exec("which claude");
    if (whichResult) return whichResult;

    // 3. 標準インストール位置を探索
    const standardPaths = [
      `${process.env.HOME}/.npm-global/bin/claude`,
      `${process.env.HOME}/.local/bin/claude`,
      "/usr/local/bin/claude",
    ];
    // ...
  }

  async start(): Promise<void> {
    const claudePath = await this.findClaudePath();

    this.pty = spawn(claudePath, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: this.cwd,
      env: { ...process.env, TERM: "xterm-256color" },
    });

    this.pty.onData((data) => {
      this.outputHistory += data;
      // 履歴サイズ制限
      if (this.outputHistory.length > PtySession.MAX_HISTORY_SIZE) {
        this.outputHistory = this.outputHistory.slice(-PtySession.MAX_HISTORY_SIZE);
      }
      this.emit("output", data);
    });

    this.pty.onExit(({ exitCode }) => {
      this.emit("exit", exitCode);
    });
  }

  // 出力のパース（ANSIコードを解析してメッセージタイプを分類）
  parseOutput(data: string): ParsedOutput[] {
    // ask_user: ユーザー選択肢を含むプロンプト
    // tool_start: ファイル操作やBashコマンド
    // diff: コード差分表示
    // text: 通常テキスト
    // ...
  }
}
```

### SessionManager の実装

```typescript
// server/session-manager.ts より抜粋
export class SessionManager {
  private sessions = new Map<string, PtySession>();

  createSession(cwd: string): PtySession {
    const id = crypto.randomUUID().slice(0, 8);
    const session = new PtySession(id, cwd);
    session.start();
    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      status: s.status,
    }));
  }

  destroySession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.stop();
    this.sessions.delete(id);
    return true;
  }

  destroyAll(): void {
    for (const session of this.sessions.values()) {
      session.stop();
    }
    this.sessions.clear();
  }
}
```

### WebSocket通信パターン

```typescript
// server/index.ts より抜粋
// バイナリ: JSON制御コマンド（認証・セッション管理）
// テキスト: ターミナルへの生入力

wss.on("connection", (ws) => {
  const state: ClientState = {
    authenticated: false,
    sessionId: null,
    outputHandler: null,
  };

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      // JSON制御コマンド
      const msg = JSON.parse(data.toString());
      handleControlMessage(ws, state, msg);
    } else {
      // ターミナル入力
      if (state.authenticated && state.sessionId) {
        const session = sessionManager.getSession(state.sessionId);
        session?.write(data.toString());
      }
    }
  });
});

function handleControlMessage(ws, state, msg) {
  switch (msg.type) {
    case "auth":
      state.authenticated = validateToken(msg.token);
      break;
    case "session:create":
      const session = sessionManager.createSession(msg.cwd);
      state.sessionId = session.id;
      // 出力をWebSocketに転送
      session.on("output", (data) => ws.send(data));
      break;
    case "session:attach":
      // 既存セッションにアタッチ
      break;
    case "resize":
      session?.resize(msg.cols, msg.rows);
      break;
  }
}
```

### フロントエンド（PWA対応）

```javascript
// web/app.js より抜粋
class TerminalApp {
  constructor() {
    this.terminal = new Terminal({
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 14,
      theme: { background: "#1a1b26" },
    });
    this.ws = null;
  }

  connect() {
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // ターミナル出力
        this.terminal.write(event.data);
      } else {
        // JSON制御メッセージ
        const msg = JSON.parse(event.data);
        this.handleControlMessage(msg);
      }
    };
  }

  // 制御コマンド送信（バイナリ）
  sendControl(message) {
    const data = new TextEncoder().encode(JSON.stringify(message));
    this.ws.send(data);
  }

  // モバイル対応: タッチスクロール、仮想キーボード
  setupMobileInput() {
    // 慣性スクロール（時間定数325ms）
    // v(t) = v0 * e^(-t/τ)
  }
}
```

### 特徴

1. **フルターミナルアクセス**: チャットUIではなく、実際のターミナル操作
2. **QRコード接続**: モバイルから簡単にアクセス
3. **Cloudflare Tunnel**: ゼロコンフィグでリモートアクセス
4. **PWA対応**: オフラインキャッシュ、Service Worker
5. **複数セッション**: タブで切り替え可能
6. **出力履歴**: 100KBまで保持、再接続時に復元

---

## 比較表

| 項目 | sugyan/claude-code-webui | KyleAMathews/claude-code-ui | yazinsai/claude-code-remote |
|------|--------------------------|----------------------------|----------------------------|
| **目的** | ウェブインターフェース | セッション監視ダッシュボード | リモートターミナルアクセス |
| **Claude通信** | `@anthropic-ai/claude-code` query() | ログファイル監視 | PTY でCLI直接起動 |
| **会話継続** | `resume: sessionId` | N/A（監視のみ） | セッション維持（PTY） |
| **ストリーミング** | NDJSON over HTTP | Durable Streams | WebSocket + xterm.js |
| **状態管理** | フロントエンドで管理 | XState状態マシン | SessionManager |
| **複数セッション** | 1セッション/接続 | 全セッション監視 | タブで複数管理 |
| **UI形式** | チャットUI | Kanbanダッシュボード | フルターミナル |
| **モバイル対応** | ❌ | ❌ | ✅ PWA + QRコード |
| **Agent SDK使用** | ❌ (claude-code) | ❌ (ログ監視) | ❌ (PTY) |

---

## 推奨アプローチ

あなたのプロジェクトでは、以下のアプローチが参考になります：

### アーキテクチャパターン

1. **yazinsai/claude-code-remote から学べること**
   - `SessionManager` パターン: Map<string, Session>でセッション管理
   - WebSocket通信: バイナリ（制御）とテキスト（入力）の分離
   - 出力パース: メッセージタイプの分類ロジック
   - 認証フロー: 接続時のトークン検証

2. **sugyan/claude-code-webui から学べること**
   - `@anthropic-ai/claude-code` パッケージの使い方
   - `query()` + `resume` で会話継続
   - NDJSONストリーミングでリアルタイム表示

3. **KyleAMathews/claude-code-ui から学べること**
   - ログファイル構造の理解
   - フック機能による状態検出
   - 複数セッションの状態管理

### Agent SDK V2 への移行

上記プロジェクトはいずれも Agent SDK V2 を使用していませんが、V2 API を使用することで：

1. `send()` / `stream()` の分離で直感的なAPI
2. `resumeSession()` でセッション再開が容易
3. `await using` による自動クリーンアップ
4. TypeScript型安全性の向上

**結論**: SessionManagerパターンとWebSocket通信の設計は参考にしつつ、Claude通信には Agent SDK V2 を採用するのがベストプラクティス。
