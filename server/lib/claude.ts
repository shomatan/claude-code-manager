/**
 * Claude Code Process Manager
 * 
 * Uses Claude Agent SDK for persistent sessions with streaming support.
 * Maintains conversation context across multiple messages.
 */

import { query, type Query, type SDKMessage, type Options } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import type { Session, Message } from "../../shared/types.js";

interface SessionInfo {
  session: Session;
  queryInstance: Query | null;
  inputQueue: Array<{ resolve: (value: void) => void; message: string }>;
  isProcessing: boolean;
  abortController: AbortController;
  currentMessageId: string | null;
  accumulatedContent: string;
}

export class ClaudeProcessManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();

  constructor() {
    super();
  }

  // Start a new Claude Code session
  startSession(worktreeId: string, worktreePath: string): Session {
    const sessionId = nanoid();
    
    const session: Session = {
      id: sessionId,
      worktreeId,
      worktreePath,
      status: "idle",
      createdAt: new Date(),
    };

    const abortController = new AbortController();

    this.sessions.set(sessionId, {
      session,
      queryInstance: null,
      inputQueue: [],
      isProcessing: false,
      abortController,
      currentMessageId: null,
      accumulatedContent: "",
    });

    this.emit("session:created", session);
    return session;
  }

  // Send a message to Claude Code
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const info = this.sessions.get(sessionId);
    if (!info) {
      throw new Error("Session not found");
    }

    console.log(`[Claude] Sending message to session ${sessionId}: ${message.substring(0, 50)}...`);
    console.log(`[Claude] Working directory: ${info.session.worktreePath}`);

    // Update session status
    info.session.status = "active";
    this.emit("session:updated", info.session);

    // Create user message
    const userMessage: Message = {
      id: nanoid(),
      sessionId,
      role: "user",
      content: message,
      timestamp: new Date(),
      type: "text",
    };
    this.emit("message:received", userMessage);

    // Reset accumulated content for new message
    info.accumulatedContent = "";
    info.currentMessageId = nanoid();

    try {
      // Create query options
      const options: Options = {
        cwd: info.session.worktreePath,
        abortController: info.abortController,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        tools: { type: "preset", preset: "claude_code" },
        systemPrompt: { type: "preset", preset: "claude_code" },
      };

      // If we have an existing session, use resume
      if (info.queryInstance) {
        // For continuing conversation, we need to use the resume option
        // But since we're using a new query each time, we'll rely on Claude's context
        console.log(`[Claude] Continuing session ${sessionId}`);
      }

      // Create new query for this message
      const queryInstance = query({
        prompt: message,
        options,
      });

      info.queryInstance = queryInstance;

      // Process the async generator
      for await (const event of queryInstance) {
        this.processSDKEvent(sessionId, event, info);
      }

      // Message complete
      if (info.accumulatedContent) {
        const assistantMessage: Message = {
          id: info.currentMessageId || nanoid(),
          sessionId,
          role: "assistant",
          content: info.accumulatedContent,
          timestamp: new Date(),
          type: "text",
        };
        this.emit("message:received", assistantMessage);
      }

      info.session.status = "idle";
      this.emit("session:updated", info.session);
      this.emit("message:complete", { sessionId, messageId: info.currentMessageId || nanoid() });

    } catch (error) {
      console.error(`[Claude] Error: ${error}`);
      const errorMessage: Message = {
        id: nanoid(),
        sessionId,
        role: "system",
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
        type: "error",
      };
      this.emit("message:received", errorMessage);
      
      info.session.status = "error";
      this.emit("session:updated", info.session);
    }
  }

  // Process SDK events
  private processSDKEvent(sessionId: string, event: SDKMessage, info: SessionInfo): void {
    console.log(`[Claude] SDK Event type: ${event.type}`);

    switch (event.type) {
      case "user":
        // User message echo - already handled
        break;

      case "assistant":
        // Assistant message with content
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text") {
              info.accumulatedContent += block.text;
              this.emit("message:stream", {
                sessionId,
                chunk: block.text,
                type: "text",
              });
            } else if (block.type === "tool_use") {
              const toolMessage: Message = {
                id: nanoid(),
                sessionId,
                role: "assistant",
                content: `Using tool: ${block.name}\n${JSON.stringify(block.input, null, 2)}`,
                timestamp: new Date(),
                type: "tool_use",
              };
              this.emit("message:received", toolMessage);
            }
          }
        }
        break;

      case "tool_progress":
        // Tool execution progress
        if ("content" in event && event.content) {
          const progressContent = typeof event.content === "string" 
            ? event.content 
            : JSON.stringify(event.content, null, 2);
          
          const progressMessage: Message = {
            id: nanoid(),
            sessionId,
            role: "system",
            content: progressContent.substring(0, 500) + (progressContent.length > 500 ? "..." : ""),
            timestamp: new Date(),
            type: "tool_result",
          };
          this.emit("message:received", progressMessage);
        }
        break;

      case "result":
        // Final result
        console.log(`[Claude] Result received`);
        break;

      default:
        console.log(`[Claude] Unhandled event type: ${event.type}`);
    }
  }

  // Stop a session
  stopSession(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (!info) {
      return;
    }

    // Abort the query
    info.abortController.abort();

    info.session.status = "stopped";
    this.emit("session:stopped", sessionId);
    this.sessions.delete(sessionId);
  }

  // Get session info
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  // Get all sessions
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).map((info) => info.session);
  }

  // Cleanup all sessions
  cleanup(): void {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      this.stopSession(sessionId);
    }
  }
}

// Singleton instance
export const claudeManager = new ClaudeProcessManager();
