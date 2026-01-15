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

### 推奨アプローチ

あなたのプロジェクトでは、**sugyan/claude-code-webui のアプローチ**が最も参考になります：

1. `@anthropic-ai/claude-code` パッケージを使用
2. `query()` + `resume` で会話継続
3. NDJSONストリーミングでリアルタイム表示

ただし、Agent SDK V2 (`unstable_v2_createSession`) を使えば、より洗練された実装が可能です。
