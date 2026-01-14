/**
 * Socket.IO Client Hook
 * 
 * Provides real-time communication with the server for:
 * - Git worktree operations
 * - Claude Code session management
 * - Message streaming
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  Worktree,
  Session,
  Message,
} from "../../../shared/types";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseSocketReturn {
  isConnected: boolean;
  error: string | null;
  
  // Repository
  repoPath: string | null;
  selectRepo: (path: string) => void;
  
  // Worktrees
  worktrees: Worktree[];
  createWorktree: (branchName: string, baseBranch?: string) => void;
  deleteWorktree: (worktreePath: string) => void;
  refreshWorktrees: () => void;
  
  // Sessions
  sessions: Map<string, Session>;
  startSession: (worktreeId: string, worktreePath: string) => void;
  stopSession: (sessionId: string) => void;
  sendMessage: (sessionId: string, message: string) => void;
  
  // Messages
  messages: Map<string, Message[]>;
  streamingContent: Map<string, string>;
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<TypedSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [messages, setMessages] = useState<Map<string, Message[]>>(new Map());
  const [streamingContent, setStreamingContent] = useState<Map<string, string>>(new Map());

  // Initialize socket connection
  useEffect(() => {
    // Connect to the server (same origin in production, localhost in dev)
    const serverUrl = import.meta.env.DEV 
      ? "http://localhost:3001" 
      : window.location.origin;
    
    const socket: TypedSocket = io(serverUrl, {
      transports: ["websocket", "polling"],
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

    // Session events
    socket.on("session:created", (session) => {
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(session.id, session);
        return next;
      });
      setMessages((prev) => {
        const next = new Map(prev);
        next.set(session.id, []);
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
        const session = next.get(sessionId);
        if (session) {
          next.set(sessionId, { ...session, status: "stopped" });
        }
        return next;
      });
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

    // Message events
    socket.on("message:received", (message) => {
      setMessages((prev) => {
        const next = new Map(prev);
        const sessionMessages = next.get(message.sessionId) || [];
        next.set(message.sessionId, [...sessionMessages, message]);
        return next;
      });
      
      // Clear streaming content when a complete message is received
      if (message.role === "assistant") {
        setStreamingContent((prev) => {
          const next = new Map(prev);
          next.delete(message.sessionId);
          return next;
        });
      }
    });

    socket.on("message:stream", ({ sessionId, chunk }) => {
      setStreamingContent((prev) => {
        const next = new Map(prev);
        const current = next.get(sessionId) || "";
        next.set(sessionId, current + chunk);
        return next;
      });
    });

    socket.on("message:complete", ({ sessionId }) => {
      // Move streaming content to messages if any
      setStreamingContent((prev) => {
        const content = prev.get(sessionId);
        if (content) {
          setMessages((msgPrev) => {
            const next = new Map(msgPrev);
            const sessionMessages = next.get(sessionId) || [];
            next.set(sessionId, [
              ...sessionMessages,
              {
                id: `stream-${Date.now()}`,
                sessionId,
                role: "assistant",
                content,
                timestamp: new Date(),
                type: "text",
              },
            ]);
            return next;
          });
        }
        
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
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
  const createWorktree = useCallback((branchName: string, baseBranch?: string) => {
    if (!repoPath) return;
    socketRef.current?.emit("worktree:create", { repoPath, branchName, baseBranch });
  }, [repoPath]);

  const deleteWorktree = useCallback((worktreePath: string) => {
    if (!repoPath) return;
    socketRef.current?.emit("worktree:delete", { repoPath, worktreePath });
  }, [repoPath]);

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
    socketRef.current?.emit("session:send", { sessionId, message });
  }, []);

  return {
    isConnected,
    error,
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
    messages,
    streamingContent,
  };
}
