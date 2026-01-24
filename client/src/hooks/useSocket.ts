/**
 * Socket.IO Client Hook
 *
 * Provides real-time communication with the server for:
 * - Git worktree operations
 * - ttyd/tmux-based Claude Code session management
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  Worktree,
  Session,
} from "../../../shared/types";

// Extended session type with ttyd fields
export interface TtydSession extends Session {
  ttydUrl?: string | null;
  ttydPort?: number | null;
  tmuxSessionName?: string;
}

// Extended event types
interface ExtendedServerToClientEvents extends Omit<ServerToClientEvents, "session:created" | "session:restored"> {
  "session:created": (session: TtydSession) => void;
  "session:restored": (session: TtydSession) => void;
}

interface ExtendedClientToServerEvents extends ClientToServerEvents {
  "session:key": (data: { sessionId: string; key: "Enter" | "C-c" | "C-d" | "y" | "n" }) => void;
}

type TypedSocket = Socket<ExtendedServerToClientEvents, ExtendedClientToServerEvents>;

// Extract token from URL
function getTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

interface UseSocketReturn {
  isConnected: boolean;
  error: string | null;

  // Allowed repositories (from --repos option)
  allowedRepos: string[];

  // Repository
  repoPath: string | null;
  selectRepo: (path: string) => void;

  // Worktrees
  worktrees: Worktree[];
  createWorktree: (branchName: string, baseBranch?: string) => void;
  deleteWorktree: (worktreePath: string) => void;
  refreshWorktrees: () => void;

  // Sessions
  sessions: Map<string, TtydSession>;
  startSession: (worktreeId: string, worktreePath: string) => void;
  stopSession: (sessionId: string) => void;
  sendMessage: (sessionId: string, message: string) => void;
  sendKey: (sessionId: string, key: "Enter" | "C-c" | "C-d" | "y" | "n") => void;
  restoreSession: (worktreePath: string) => void;
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<TypedSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowedRepos, setAllowedRepos] = useState<string[]>([]);

  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [sessions, setSessions] = useState<Map<string, TtydSession>>(new Map());

  // Initialize socket connection
  useEffect(() => {
    const serverUrl = import.meta.env.DEV
      ? "http://localhost:3001"
      : window.location.origin;

    const token = getTokenFromUrl();
    const socket: TypedSocket = io(serverUrl, {
      transports: ["websocket", "polling"],
      auth: token ? { token } : undefined,
    });

    socketRef.current = socket;

    // Connection events
    socket.on("connect", () => {
      console.log("Socket connected");
      setIsConnected(true);
      setError(null);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected");
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setError("Failed to connect to server");
      setIsConnected(false);
    });

    // Allowed repositories list
    socket.on("repos:list", (repos) => {
      console.log("Allowed repos received:", repos);
      setAllowedRepos(repos);
    });

    // Repository events
    socket.on("repo:set", (path) => {
      setRepoPath(path);
      setError(null);
    });

    socket.on("repo:error", (err) => {
      setError(err);
    });

    // Worktree events
    socket.on("worktree:list", (wts) => {
      setWorktrees(wts);
    });

    socket.on("worktree:created", (wt) => {
      setWorktrees((prev) => [...prev, wt]);
    });

    socket.on("worktree:deleted", (wtId) => {
      setWorktrees((prev) => prev.filter((w) => w.id !== wtId));
    });

    socket.on("worktree:error", (err) => {
      setError(err);
    });

    // Session events (ttyd-based)
    socket.on("session:created", (session) => {
      console.log("[Socket] Session created:", session.id, "ttydUrl:", session.ttydUrl);
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(session.id, session);
        return next;
      });
    });

    socket.on("session:updated", (session) => {
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(session.id, session);
        return next;
      });
    });

    socket.on("session:stopped", (sessionId) => {
      setSessions((prev) => {
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
    });

    socket.on("session:restored", (session) => {
      console.log("[Socket] Session restored:", session.id, "ttydUrl:", session.ttydUrl);
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(session.id, session);
        return next;
      });
    });

    socket.on("session:restore_failed", ({ worktreePath: _path, error: err }) => {
      console.log("[Socket] Session restore failed:", err);
    });

    socket.on("session:error", ({ sessionId, error: err }) => {
      setError(err);
      if (sessionId) {
        setSessions((prev) => {
          const next = new Map(prev);
          const session = next.get(sessionId);
          if (session) {
            next.set(sessionId, { ...session, status: "error" });
          }
          return next;
        });
      }
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, []);

  // Repository actions
  const selectRepo = useCallback((path: string) => {
    socketRef.current?.emit("repo:select", path);
  }, []);

  // Worktree actions
  const createWorktree = useCallback(
    (branchName: string, baseBranch?: string) => {
      if (!repoPath) return;
      socketRef.current?.emit("worktree:create", { repoPath, branchName, baseBranch });
    },
    [repoPath]
  );

  const deleteWorktree = useCallback(
    (worktreePath: string) => {
      if (!repoPath) return;
      socketRef.current?.emit("worktree:delete", { repoPath, worktreePath });
    },
    [repoPath]
  );

  const refreshWorktrees = useCallback(() => {
    if (!repoPath) return;
    socketRef.current?.emit("worktree:list", repoPath);
  }, [repoPath]);

  // Session actions
  const startSession = useCallback((worktreeId: string, worktreePath: string) => {
    socketRef.current?.emit("session:start", { worktreeId, worktreePath });
  }, []);

  const stopSession = useCallback((sessionId: string) => {
    socketRef.current?.emit("session:stop", sessionId);
  }, []);

  const sendMessage = useCallback((sessionId: string, message: string) => {
    // For ttyd approach, we just send the message to tmux
    // No local message state management needed (ttyd handles display)
    socketRef.current?.emit("session:send", { sessionId, message });
  }, []);

  const sendKey = useCallback(
    (sessionId: string, key: "Enter" | "C-c" | "C-d" | "y" | "n") => {
      socketRef.current?.emit("session:key", { sessionId, key });
    },
    []
  );

  const restoreSession = useCallback((worktreePath: string) => {
    socketRef.current?.emit("session:restore", worktreePath);
  }, []);

  return {
    isConnected,
    error,
    allowedRepos,
    repoPath,
    selectRepo,
    worktrees,
    createWorktree,
    deleteWorktree,
    refreshWorktrees,
    sessions,
    startSession,
    stopSession,
    sendMessage,
    sendKey,
    restoreSession,
  };
}
