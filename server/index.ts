/**
 * Claude Code Manager - Server
 * 
 * Express server with Socket.IO for real-time communication.
 * Handles git worktree operations and Claude Code process management.
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { listWorktrees, createWorktree, deleteWorktree, isGitRepository } from "./lib/git.js";
import { claudeManager } from "./lib/claude.js";
import type { ServerToClientEvents, ClientToServerEvents, Message, Session } from "../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  
  // Initialize Socket.IO
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

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
        const session = claudeManager.startSession(worktreeId, worktreePath);
        messageHistory.set(session.id, []);
        socket.emit("session:created", session);
      } catch (error) {
        socket.emit("session:error", {
          sessionId: "",
          error: error instanceof Error ? error.message : "Unknown error",
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

    // Register event listeners
    claudeManager.on("session:created", onSessionCreated);
    claudeManager.on("session:updated", onSessionUpdated);
    claudeManager.on("session:stopped", onSessionStopped);
    claudeManager.on("message:received", onMessageReceived);
    claudeManager.on("message:stream", onMessageStream);
    claudeManager.on("message:complete", onMessageComplete);

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
    });
  });

  const port = process.env.PORT || 3001;

  server.listen(port, () => {
    console.log(`Claude Code Manager server running on http://localhost:${port}/`);
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
