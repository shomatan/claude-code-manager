# Claude Code Manager - 開発引き継ぎ資料

このドキュメントはClaude Codeが開発を引き継ぐための資料です。

## プロジェクト概要

**Claude Code Manager**は、ローカルで稼働する複数のClaude Codeインスタンスを管理するWebUIアプリケーションです。ユーザーがgit worktreeを選択し、各worktreeに対してClaude Codeセッションを起動・管理できます。

## 現在の実装状況

### 完了している機能

| 機能 | 状態 | 説明 |
|------|------|------|
| Git Worktree管理 | ✅ 完了 | 一覧表示、作成、削除 |
| セッション管理 | ✅ 完了 | 起動、停止、状態管理 |
| チャットUI | ✅ 完了 | メッセージ表示、入力フォーム |
| Socket.IO通信 | ✅ 完了 | リアルタイムストリーミング |
| Claude Agent SDK統合 | ⚠️ 部分的 | 基本動作するが会話継続に課題 |

### 未完了・改善が必要な機能

1. **会話の継続性**: 現在は各メッセージごとに新しい`query()`を作成しているため、会話コンテキストが維持されない
2. **ユーザーメッセージの表示**: ChatPaneでユーザーメッセージが表示されない問題がある
3. **マルチペインビュー**: 複数セッションを同時に表示する機能
4. **セッション履歴の永続化**: localStorage または ファイルベースでの保存

---

## 🚨 最優先タスク: 会話継続の実装

### 問題

現在の`server/lib/claude.ts`は、各メッセージごとに新しい`query()`を作成しています。これにより：
- 毎回新しいセッションが開始される
- 会話コンテキストが維持されない
- 毎回プロセス起動のオーバーヘッドがある

### 解決策: TypeScript SDK V2 インターフェース

Claude Agent SDK TypeScriptには**V2インターフェース（プレビュー）**があり、`send()`/`stream()`パターンで会話継続が簡単に実装できます。

**参考ドキュメント**: https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview

### V2 API の主要コンセプト

| 関数 | 説明 |
|------|------|
| `unstable_v2_createSession()` | 新しいセッションを作成 |
| `unstable_v2_resumeSession(sessionId)` | 既存セッションを再開 |
| `session.send(message)` | メッセージを送信 |
| `session.stream()` | レスポンスをストリーミング受信 |
| `session.close()` | セッションを閉じる |

### 実装プラン

#### Step 1: claude.ts を V2 API に移行

```typescript
// server/lib/claude.ts

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage,
  type Session as SDKSession,
} from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import type { Session, Message } from "../../shared/types.js";

interface SessionInfo {
  session: Session;
  sdkSession: SDKSession | null;  // V2 SDK セッション
  sdkSessionId: string | null;    // 再開用のセッションID
}

export class ClaudeProcessManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();

  // セッション開始
  async startSession(worktreeId: string, worktreePath: string): Promise<Session> {
    const sessionId = nanoid();
    
    const session: Session = {
      id: sessionId,
      worktreeId,
      worktreePath,
      status: "idle",
      createdAt: new Date(),
    };

    // V2 SDK セッションを作成
    const sdkSession = unstable_v2_createSession({
      cwd: worktreePath,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: { type: "preset", preset: "claude_code" },
      systemPrompt: { type: "preset", preset: "claude_code" },
    });

    this.sessions.set(sessionId, {
      session,
      sdkSession,
      sdkSessionId: null,
    });

    this.emit("session:created", session);
    return session;
  }

  // メッセージ送信（会話継続）
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const info = this.sessions.get(sessionId);
    if (!info || !info.sdkSession) {
      throw new Error("Session not found");
    }

    // ユーザーメッセージを送信
    const userMessage: Message = {
      id: nanoid(),
      sessionId,
      role: "user",
      content: message,
      timestamp: new Date(),
      type: "text",
    };
    this.emit("message:received", userMessage);

    info.session.status = "active";
    this.emit("session:updated", info.session);

    try {
      // V2 API: send() でメッセージ送信
      await info.sdkSession.send(message);

      // V2 API: stream() でレスポンス受信
      let accumulatedContent = "";
      for await (const msg of info.sdkSession.stream()) {
        // セッションIDを保存（再開用）
        if (!info.sdkSessionId && msg.session_id) {
          info.sdkSessionId = msg.session_id;
        }

        if (msg.type === "assistant") {
          const text = msg.message.content
            .filter((block: any) => block.type === "text")
            .map((block: any) => block.text)
            .join("");
          
          if (text) {
            accumulatedContent += text;
            this.emit("message:stream", {
              sessionId,
              chunk: text,
              type: "text",
            });
          }
        }
      }

      // 完了メッセージ
      if (accumulatedContent) {
        const assistantMessage: Message = {
          id: nanoid(),
          sessionId,
          role: "assistant",
          content: accumulatedContent,
          timestamp: new Date(),
          type: "text",
        };
        this.emit("message:received", assistantMessage);
      }

      info.session.status = "idle";
      this.emit("session:updated", info.session);
      this.emit("message:complete", { sessionId, messageId: nanoid() });

    } catch (error) {
      console.error(`[Claude] Error: ${error}`);
      info.session.status = "error";
      this.emit("session:updated", info.session);
    }
  }

  // セッション停止
  stopSession(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (!info) return;

    // V2 API: セッションを閉じる
    if (info.sdkSession) {
      info.sdkSession.close();
    }

    info.session.status = "stopped";
    this.emit("session:stopped", sessionId);
    this.sessions.delete(sessionId);
  }
}
```

#### Step 2: セッション再開機能の追加

ブラウザリロード後もセッションを再開できるようにする：

```typescript
// セッション再開
async resumeSession(sessionId: string, sdkSessionId: string, worktreePath: string): Promise<void> {
  const sdkSession = unstable_v2_resumeSession(sdkSessionId, {
    cwd: worktreePath,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
  });

  // 既存のセッション情報を更新
  const info = this.sessions.get(sessionId);
  if (info) {
    info.sdkSession = sdkSession;
    info.sdkSessionId = sdkSessionId;
  }
}
```

### 実装手順チェックリスト

1. [ ] `server/lib/claude.ts` を V2 API に書き換え
2. [ ] `unstable_v2_createSession()` でセッション作成
3. [ ] `session.send()` / `session.stream()` でメッセージ送受信
4. [ ] `session_id` を保存して再開可能に
5. [ ] `session.close()` でクリーンアップ
6. [ ] エラーハンドリングの追加
7. [ ] フロントエンドでのメッセージ表示修正

---

## 技術スタック

```
フロントエンド:
- React 19
- TypeScript
- Tailwind CSS 4
- shadcn/ui
- Socket.IO Client
- Wouter (ルーティング)

バックエンド:
- Express
- Socket.IO
- Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
- nanoid

ビルドツール:
- Vite
- esbuild
- tsx (開発時)
```

## ディレクトリ構造

```
claude-code-manager/
├── client/                    # フロントエンド
│   ├── src/
│   │   ├── components/        # UIコンポーネント
│   │   │   ├── Dashboard.tsx  # メインダッシュボード
│   │   │   ├── ChatPane.tsx   # チャットUI
│   │   │   ├── Sidebar.tsx    # サイドバー
│   │   │   └── ui/            # shadcn/ui コンポーネント
│   │   ├── hooks/
│   │   │   └── useSocket.ts   # Socket.IO フック
│   │   ├── pages/
│   │   │   └── Home.tsx       # ホームページ
│   │   └── App.tsx            # ルート
│   └── index.html
├── server/                    # バックエンド
│   ├── index.ts               # Expressサーバー
│   └── lib/
│       ├── claude.ts          # Claude Agent SDK統合 ← 要修正
│       └── git.ts             # Git worktree操作
├── shared/                    # 共有型定義
│   └── types.ts
└── package.json
```

## 開発コマンド

```bash
# 依存関係のインストール
pnpm install

# フロントエンドのみ起動
pnpm dev

# フルスタック開発（推奨）
pnpm dev:full

# 型チェック
pnpm check

# ビルド
pnpm build

# 本番実行
pnpm start
```

## Socket.IOイベント一覧

### クライアント → サーバー

| イベント | データ | 説明 |
|----------|--------|------|
| `repo:select` | `path: string` | リポジトリを選択 |
| `worktree:list` | `repoPath: string` | worktree一覧を取得 |
| `worktree:create` | `{ repoPath, branchName, baseBranch? }` | worktreeを作成 |
| `worktree:delete` | `{ repoPath, worktreePath }` | worktreeを削除 |
| `session:start` | `{ worktreeId, worktreePath }` | セッションを開始 |
| `session:stop` | `sessionId: string` | セッションを停止 |
| `session:send` | `{ sessionId, message }` | メッセージを送信 |

### サーバー → クライアント

| イベント | データ | 説明 |
|----------|--------|------|
| `repo:set` | `path: string` | リポジトリが設定された |
| `repo:error` | `error: string` | リポジトリエラー |
| `worktree:list` | `Worktree[]` | worktree一覧 |
| `worktree:created` | `Worktree` | worktreeが作成された |
| `worktree:error` | `error: string` | worktreeエラー |
| `session:created` | `Session` | セッションが作成された |
| `session:updated` | `Session` | セッション状態が更新された |
| `session:stopped` | `sessionId: string` | セッションが停止した |
| `session:error` | `{ sessionId, error }` | セッションエラー |
| `message:received` | `Message` | メッセージを受信 |
| `message:stream` | `{ sessionId, chunk }` | ストリーミングチャンク |
| `message:complete` | `{ sessionId, messageId }` | メッセージ完了 |

## デザインガイドライン

**テーマ**: Terminal-Inspired Dark Mode

| 要素 | 値 |
|------|-----|
| 背景色 | `#0D1117` |
| アクセント（緑） | `#00FF88` |
| アクセント（シアン） | `#00D4FF` |
| フォント | JetBrains Mono |

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `PORT` | `3001` | バックエンドサーバーのポート |
| `ANTHROPIC_API_KEY` | - | Anthropic APIキー（SDK使用時） |

## 既知の問題

1. **会話継続**: 現在は各メッセージごとに新しいセッションを作成している（V2 APIで解決予定）
2. **ユーザーメッセージ表示**: ChatPaneでユーザーメッセージが表示されない
3. **権限プロンプト**: `bypassPermissions`モードで回避中

## 参考リンク

- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [TypeScript SDK V2 (Preview)](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) ← 推奨
- [GitHub Repository](https://github.com/shomatan/claude-code-manager)

## 連絡先

質問や不明点があれば、このリポジトリのIssueで報告してください。
