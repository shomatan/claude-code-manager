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

# 🚨 Agent SDK V2 フルコミット実装計画

## 公式サンプルの分析

### 1. hello-world-v2/v2-examples.ts

V2 APIの基本パターン：

```typescript
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  unstable_v2_prompt,
} from '@anthropic-ai/claude-agent-sdk';

// 基本パターン: セッション作成 → send → stream
await using session = unstable_v2_createSession({ model: 'sonnet' });
await session.send('Hello!');
for await (const msg of session.stream()) {
  if (msg.type === 'assistant') {
    const text = msg.message.content.find(c => c.type === 'text');
    console.log(text?.text);
  }
}

// マルチターン: 同じセッションで複数回send/stream
await session.send('Follow-up question');
for await (const msg of session.stream()) { /* ... */ }

// セッション再開: sessionIdを保存して後で再開
await using session = unstable_v2_resumeSession(sessionId, { model: 'sonnet' });
```

### 2. simple-chatapp/server/ai-client.ts

**重要な発見:** 公式チャットアプリは**V1 API (`query()`)** を使用し、`AsyncIterable`をpromptに渡すことで会話継続を実現している。

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

class MessageQueue {
  private messages: UserMessage[] = [];
  private waiting: ((msg: UserMessage) => void) | null = null;

  push(content: string) {
    const msg: UserMessage = {
      type: "user",
      message: { role: "user", content },
    };
    if (this.waiting) {
      this.waiting(msg);
      this.waiting = null;
    } else {
      this.messages.push(msg);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<UserMessage> {
    while (!this.closed) {
      if (this.messages.length > 0) {
        yield this.messages.shift()!;
      } else {
        yield await new Promise<UserMessage>(resolve => {
          this.waiting = resolve;
        });
      }
    }
  }
}

export class AgentSession {
  private queue = new MessageQueue();
  private outputIterator: AsyncIterator<any>;

  constructor() {
    // query()にAsyncIterableを渡すと、会話が継続する
    this.outputIterator = query({
      prompt: this.queue as any,
      options: {
        maxTurns: 100,
        model: "opus",
        allowedTools: ["Bash", "Read", "Write", ...],
      },
    })[Symbol.asyncIterator]();
  }

  sendMessage(content: string) {
    this.queue.push(content);
  }

  async *getOutputStream() {
    while (true) {
      const { value, done } = await this.outputIterator.next();
      if (done) break;
      yield value;
    }
  }
}
```

---

## 実装方針: V2 Session API にフルコミット

### 理由

1. 公式が将来的にV2を推奨する方向
2. `send()` / `stream()` の分離が直感的
3. `resumeSession()` でセッション再開が容易
4. `await using` による自動クリーンアップ

---

## Phase 1: バックエンド再設計

### 1.1 セッションマネージャーの作成

```typescript
// server/lib/session-manager.ts
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type Session,
} from '@anthropic-ai/claude-agent-sdk';

interface ManagedSession {
  session: Session;
  sessionId: string;
  worktreePath: string;
  createdAt: Date;
  lastActivity: Date;
}

class SessionManager {
  private sessions = new Map<string, ManagedSession>();

  async createSession(worktreePath: string): Promise<ManagedSession> {
    const session = unstable_v2_createSession({
      model: 'sonnet',
      cwd: worktreePath,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    });
    
    // 初期化メッセージからsessionIdを取得
    let sessionId: string | undefined;
    for await (const msg of session.stream()) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id;
        break;
      }
    }
    
    const managed: ManagedSession = {
      session,
      sessionId: sessionId!,
      worktreePath,
      createdAt: new Date(),
      lastActivity: new Date(),
    };
    
    this.sessions.set(sessionId!, managed);
    return managed;
  }

  async resumeSession(sessionId: string): Promise<ManagedSession | null> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    
    try {
      const session = unstable_v2_resumeSession(sessionId, { model: 'sonnet' });
      const managed: ManagedSession = {
        session,
        sessionId,
        worktreePath: '', // 再開時は不明
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      this.sessions.set(sessionId, managed);
      return managed;
    } catch {
      return null;
    }
  }

  getSession(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      this.sessions.delete(sessionId);
    }
  }
}

export const sessionManager = new SessionManager();
```

### 1.2 Socket.IOハンドラーの更新

```typescript
// server/lib/socket-handlers.ts
import { sessionManager } from './session-manager';

export function setupSocketHandlers(io: Server) {
  io.on('connection', (socket) => {
    let currentSessionId: string | null = null;

    // 新規セッション開始
    socket.on('start_session', async (data: { worktreePath: string }) => {
      try {
        const managed = await sessionManager.createSession(data.worktreePath);
        currentSessionId = managed.sessionId;
        socket.emit('session_started', { sessionId: managed.sessionId });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // セッション再開
    socket.on('resume_session', async (data: { sessionId: string }) => {
      try {
        const managed = await sessionManager.resumeSession(data.sessionId);
        if (managed) {
          currentSessionId = managed.sessionId;
          socket.emit('session_resumed', { sessionId: managed.sessionId });
        } else {
          socket.emit('error', { message: 'Session not found' });
        }
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // メッセージ送信
    socket.on('send_message', async (data: { message: string }) => {
      if (!currentSessionId) {
        socket.emit('error', { message: 'No active session' });
        return;
      }

      const managed = sessionManager.getSession(currentSessionId);
      if (!managed) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }

      try {
        // メッセージを送信
        await managed.session.send(data.message);
        
        // ストリーミングレスポンスを処理
        for await (const msg of managed.session.stream()) {
          socket.emit('claude_message', msg);
          
          // 完了メッセージ
          if (msg.type === 'result') {
            socket.emit('message_complete', {
              success: msg.subtype === 'success',
              cost: msg.total_cost_usd,
              duration: msg.duration_ms,
            });
          }
        }
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('disconnect', () => {
      currentSessionId = null;
    });
  });
}
```

---

## Phase 2: フロントエンド更新

### 2.1 セッション状態管理

```typescript
// client/src/hooks/useClaudeSession.ts
import { useSocket } from './useSocket';
import { useState, useCallback, useEffect } from 'react';

interface SessionState {
  sessionId: string | null;
  status: 'idle' | 'connecting' | 'active' | 'error';
  messages: ClaudeMessage[];
}

export function useClaudeSession(worktreePath: string) {
  const socket = useSocket();
  const [state, setState] = useState<SessionState>({
    sessionId: null,
    status: 'idle',
    messages: [],
  });

  const startSession = useCallback(async () => {
    setState(s => ({ ...s, status: 'connecting' }));
    socket.emit('start_session', { worktreePath });
  }, [socket, worktreePath]);

  const resumeSession = useCallback(async (sessionId: string) => {
    setState(s => ({ ...s, status: 'connecting' }));
    socket.emit('resume_session', { sessionId });
  }, [socket]);

  const sendMessage = useCallback((message: string) => {
    socket.emit('send_message', { message });
    setState(s => ({
      ...s,
      messages: [...s.messages, { type: 'user', content: message }],
    }));
  }, [socket]);

  useEffect(() => {
    socket.on('session_started', ({ sessionId }) => {
      setState(s => ({ ...s, sessionId, status: 'active' }));
      localStorage.setItem(`session:${worktreePath}`, sessionId);
    });

    socket.on('claude_message', (msg) => {
      setState(s => ({
        ...s,
        messages: [...s.messages, msg],
      }));
    });

    socket.on('error', ({ message }) => {
      setState(s => ({ ...s, status: 'error' }));
      console.error('Session error:', message);
    });

    return () => {
      socket.off('session_started');
      socket.off('claude_message');
      socket.off('error');
    };
  }, [socket, worktreePath]);

  return {
    ...state,
    startSession,
    resumeSession,
    sendMessage,
  };
}
```

### 2.2 メッセージ表示コンポーネント

```typescript
// client/src/components/ClaudeMessage.tsx
interface ClaudeMessageProps {
  message: SDKMessage;
}

export function ClaudeMessage({ message }: ClaudeMessageProps) {
  switch (message.type) {
    case 'assistant':
      return <AssistantMessage content={message.message.content} />;
    
    case 'user':
      return <UserMessage content={message.message.content} />;
    
    case 'result':
      return (
        <ResultMessage
          success={message.subtype === 'success'}
          cost={message.total_cost_usd}
          duration={message.duration_ms}
        />
      );
    
    default:
      return null;
  }
}

function AssistantMessage({ content }: { content: ContentBlock[] }) {
  return (
    <div className="flex gap-3">
      <Avatar>Claude</Avatar>
      <div className="flex-1">
        {content.map((block, i) => {
          if (block.type === 'text') {
            return <Markdown key={i}>{block.text}</Markdown>;
          }
          if (block.type === 'tool_use') {
            return <ToolUseBlock key={i} tool={block} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}
```

---

## Phase 3: 追加機能

### 3.1 セッション永続化

```typescript
// セッションIDをworktreeごとに保存
const savedSessionId = localStorage.getItem(`session:${worktreePath}`);
if (savedSessionId) {
  resumeSession(savedSessionId);
} else {
  startSession();
}
```

### 3.2 ツール承認UI

```typescript
socket.on('claude_message', (msg) => {
  if (msg.type === 'tool_use' && msg.requires_approval) {
    showApprovalDialog(msg);
  }
});
```

---

## 実装チェックリスト

### バックエンド

- [ ] `@anthropic-ai/claude-agent-sdk` パッケージのインストール確認
- [ ] `server/lib/session-manager.ts` の作成
- [ ] `server/lib/socket-handlers.ts` の更新
- [ ] `server/lib/claude.ts` の削除（spawn不要）
- [ ] セッションIDの永続化（オプション）

### フロントエンド

- [ ] `useClaudeSession` フックの作成
- [ ] `ClaudeMessage` コンポーネントの作成
- [ ] セッション状態のUI表示
- [ ] ツール承認ダイアログ

### テスト

- [ ] セッション作成のテスト
- [ ] マルチターン会話のテスト
- [ ] セッション再開のテスト
- [ ] エラーハンドリングのテスト

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | React 19, TailwindCSS 4, shadcn/ui |
| Backend | Express, Socket.IO |
| Claude通信 | `@anthropic-ai/claude-agent-sdk` (V2 API) |
| 状態管理 | React hooks + Context |

## ディレクトリ構造

```
claude-code-manager/
├── client/
│   └── src/
│       ├── components/
│       │   ├── ClaudeMessage.tsx    # メッセージ表示
│       │   ├── ChatInput.tsx        # 入力フォーム
│       │   └── SessionStatus.tsx    # セッション状態
│       ├── hooks/
│       │   ├── useClaudeSession.ts  # セッション管理
│       │   └── useSocket.ts         # Socket.IO
│       └── pages/
│           └── Chat.tsx             # チャット画面
├── server/
│   ├── lib/
│   │   ├── session-manager.ts       # セッション管理（新規）
│   │   └── socket-handlers.ts       # Socket.IOハンドラー（更新）
│   └── index.ts
└── shared/
    └── types.ts                     # 共通型定義
```

---

## Socket.IOイベント一覧

### クライアント → サーバー

| イベント | データ | 説明 |
|----------|--------|------|
| `start_session` | `{ worktreePath }` | 新規セッション開始 |
| `resume_session` | `{ sessionId }` | セッション再開 |
| `send_message` | `{ message }` | メッセージ送信 |

### サーバー → クライアント

| イベント | データ | 説明 |
|----------|--------|------|
| `session_started` | `{ sessionId }` | セッション開始完了 |
| `session_resumed` | `{ sessionId }` | セッション再開完了 |
| `claude_message` | SDKMessage | Claudeからのメッセージ |
| `message_complete` | `{ success, cost, duration }` | メッセージ完了 |
| `error` | `{ message }` | エラー |

---

## 参考リンク

- [Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [公式V2サンプル](https://github.com/anthropics/claude-agent-sdk-demos/tree/main/hello-world-v2)
- [公式チャットアプリ](https://github.com/anthropics/claude-agent-sdk-demos/tree/main/simple-chatapp)
- [類似プロジェクト解説](./docs/similar-projects-analysis.md)
