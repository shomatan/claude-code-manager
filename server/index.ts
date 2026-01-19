/**
 * Claude Code Manager - Server
 *
 * Express server with Socket.IO for real-time communication.
 * Handles git worktree operations and Claude Code process management.
 * Supports remote access via Cloudflare Tunnel.
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import {
  listWorktrees,
  createWorktree,
  deleteWorktree,
  isGitRepository,
} from "./lib/git.js";
import { claudeManager } from "./lib/claude.js";
import { TunnelManager } from "./lib/tunnel.js";
import { authManager } from "./lib/auth.js";
import { printRemoteAccessInfo } from "./lib/qrcode.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  Message,
  Session,
} from "../shared/types.js";

// Parse command line arguments
const args = process.argv.slice(2);
const enableRemote = args.includes("--remote") || args.includes("-r");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const port = Number(process.env.PORT) || 3001;

  // Enable authentication if remote access is enabled
  if (enableRemote) {
    authManager.enable();
    console.log("Remote access mode enabled - authentication required");
  }

  // Apply HTTP authentication middleware
  app.use(authManager.httpMiddleware());

  // Initialize Socket.IO
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Apply Socket.IO authentication middleware
  io.use(authManager.socketMiddleware());

  // Serve static files from dist/public in production only
  // In development, Vite dev server handles static files
  if (process.env.NODE_ENV === "production") {
    const staticPath = path.resolve(__dirname, "public");
    app.use(express.static(staticPath));

    // Handle client-side routing - serve index.html for all routes
    app.get("*", (_req, res) => {
      res.sendFile(path.join(staticPath, "index.html"));
    });
  }

  // Socket.IO connection handler
  io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Store message history per session
    const messageHistory: Map<string, Message[]> = new Map();

    // ===== Repository Commands =====
    
    socket.on("repo:select", async (repoPath) => {
      try {
        const isRepo = await isGitRepository(repoPath);
        if (!isRepo) {
          socket.emit("repo:error", "Not a valid git repository");
          return;
        }
        socket.emit("repo:set", repoPath);
        
        // Automatically list worktrees
        const worktrees = await listWorktrees(repoPath);
        socket.emit("worktree:list", worktrees);
      } catch (error) {
        socket.emit("repo:error", error instanceof Error ? error.message : "Unknown error");
      }
    });

    // ===== Worktree Commands =====
    
    socket.on("worktree:list", async (repoPath) => {
      try {
        const worktrees = await listWorktrees(repoPath);
        socket.emit("worktree:list", worktrees);
      } catch (error) {
        socket.emit("worktree:error", error instanceof Error ? error.message : "Unknown error");
      }
    });

    socket.on("worktree:create", async ({ repoPath, branchName, baseBranch }) => {
      try {
        const worktree = await createWorktree(repoPath, branchName, baseBranch);
        socket.emit("worktree:created", worktree);
        
        // Refresh worktree list
        const worktrees = await listWorktrees(repoPath);
        socket.emit("worktree:list", worktrees);
      } catch (error) {
        socket.emit("worktree:error", error instanceof Error ? error.message : "Unknown error");
      }
    });

    socket.on("worktree:delete", async ({ repoPath, worktreePath }) => {
      try {
        await deleteWorktree(repoPath, worktreePath);
        
        // Find and stop any session using this worktree
        const sessions = claudeManager.getAllSessions();
        for (const session of sessions) {
          if (session.worktreePath === worktreePath) {
            claudeManager.stopSession(session.id);
          }
        }
        
        // Refresh worktree list
        const worktrees = await listWorktrees(repoPath);
        socket.emit("worktree:list", worktrees);
      } catch (error) {
        socket.emit("worktree:error", error instanceof Error ? error.message : "Unknown error");
      }
    });

    // ===== Session Commands =====
    
    socket.on("session:start", ({ worktreeId, worktreePath }) => {
      try {
        // claudeManager内で既存セッションが見つかった場合は
        // session:restoredイベントがemitされる
        const session = claudeManager.startSession(worktreeId, worktreePath);

        // 新規セッションの場合のみmessageHistoryを初期化
        if (!messageHistory.has(session.id)) {
          messageHistory.set(session.id, []);
        }
        // session:createdはclaudeManager内でemitされるので
        // ここでのemitは削除
      } catch (error) {
        socket.emit("session:error", {
          sessionId: "",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    socket.on("session:restore", (worktreePath) => {
      try {
        const result = claudeManager.restoreSession(worktreePath);
        if (result) {
          messageHistory.set(result.session.id, result.messages);
          socket.emit("session:restored", {
            session: result.session,
            messages: result.messages
          });
        } else {
          socket.emit("session:restore_failed", {
            worktreePath,
            error: "No existing session found"
          });
        }
      } catch (error) {
        socket.emit("session:restore_failed", {
          worktreePath,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });

    socket.on("session:stop", (sessionId) => {
      claudeManager.stopSession(sessionId);
      messageHistory.delete(sessionId);
    });

    socket.on("session:send", async ({ sessionId, message }) => {
      try {
        await claudeManager.sendMessage(sessionId, message);
      } catch (error) {
        socket.emit("session:error", {
          sessionId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // ===== Claude Manager Event Handlers =====
    
    const onSessionCreated = (session: Session) => {
      socket.emit("session:created", session);
    };

    const onSessionUpdated = (session: Session) => {
      socket.emit("session:updated", session);
    };

    const onSessionStopped = (sessionId: string) => {
      socket.emit("session:stopped", sessionId);
    };

    const onMessageReceived = (message: Message) => {
      // Store in history
      const history = messageHistory.get(message.sessionId) || [];
      history.push(message);
      messageHistory.set(message.sessionId, history);
      
      socket.emit("message:received", message);
    };

    const onMessageStream = (data: { sessionId: string; chunk: string; type?: string }) => {
      socket.emit("message:stream", data as { sessionId: string; chunk: string });
    };

    const onMessageComplete = (data: { sessionId: string; messageId: string }) => {
      socket.emit("message:complete", data);
    };

    const onSessionRestored = (session: Session, messages: Message[]) => {
      messageHistory.set(session.id, messages);
      socket.emit("session:restored", { session, messages });
    };

    // Register event listeners
    claudeManager.on("session:created", onSessionCreated);
    claudeManager.on("session:updated", onSessionUpdated);
    claudeManager.on("session:stopped", onSessionStopped);
    claudeManager.on("message:received", onMessageReceived);
    claudeManager.on("message:stream", onMessageStream);
    claudeManager.on("message:complete", onMessageComplete);
    claudeManager.on("session:restored", onSessionRestored);

    // Cleanup on disconnect
    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);

      // Remove event listeners
      claudeManager.off("session:created", onSessionCreated);
      claudeManager.off("session:updated", onSessionUpdated);
      claudeManager.off("session:stopped", onSessionStopped);
      claudeManager.off("message:received", onMessageReceived);
      claudeManager.off("message:stream", onMessageStream);
      claudeManager.off("message:complete", onMessageComplete);
      claudeManager.off("session:restored", onSessionRestored);
    });
  });

  server.listen(port, async () => {
    console.log(
      `Claude Code Manager server running on http://localhost:${port}/`
    );

    // Start tunnel if remote access is enabled
    if (enableRemote) {
      console.log("Starting Cloudflare Tunnel...");
      const tunnel = new TunnelManager(port);

      try {
        const publicUrl = await tunnel.start();
        const authUrl = authManager.buildAuthUrl(publicUrl);
        await printRemoteAccessInfo(authUrl, authManager.getToken());

        // Handle tunnel events
        tunnel.on("error", (error) => {
          console.error("Tunnel error:", error.message);
        });

        tunnel.on("close", (code) => {
          console.log(`Tunnel closed with code ${code}`);
        });

        // Cleanup tunnel on shutdown
        const originalCleanup = () => {
          tunnel.stop();
        };

        process.on("SIGTERM", originalCleanup);
        process.on("SIGINT", originalCleanup);
      } catch (error) {
        console.error(
          "Failed to start tunnel:",
          error instanceof Error ? error.message : error
        );
        console.log("Continuing without remote access...");
      }
    }
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("Shutting down...");
    claudeManager.cleanup();
    server.close(() => {
      process.exit(0);
    });
  });

  process.on("SIGINT", () => {
    console.log("Shutting down...");
    claudeManager.cleanup();
    server.close(() => {
      process.exit(0);
    });
  });
}

startServer().catch(console.error);
