/**
 * Claude Code Process Manager
 * 
 * Manages Claude Code CLI processes for each session.
 * Uses stream-json output format for structured communication.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import type { Session, Message, ClaudeStreamEvent, SessionStatus } from "../../shared/types.js";

interface ProcessInfo {
  process: ChildProcess;
  session: Session;
  buffer: string;
}

export class ClaudeProcessManager extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map();

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

    this.processes.set(sessionId, {
      process: null as unknown as ChildProcess,
      session,
      buffer: "",
    });

    this.emit("session:created", session);
    return session;
  }

  // Send a message to Claude Code
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const info = this.processes.get(sessionId);
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

    // Use CLAUDE_PATH env var or default to 'claude'
    const claudePath = process.env.CLAUDE_PATH || "claude";
    console.log(`[Claude] Using claude path: ${claudePath}`);

    // Build arguments array
    const args = [
      "-p", message,
      "--output-format", "stream-json",
      "--verbose",
    ];
    console.log(`[Claude] Spawning: ${claudePath} ${args.join(" ")}`);

    // Spawn Claude Code process
    const claudeProcess = spawn(claudePath, args, {
      cwd: info.session.worktreePath,
      env: {
        ...process.env,
        // Ensure Claude Code runs in non-interactive mode
        CI: "true",
        // Ensure PATH includes common locations
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
      },
      stdio: ["pipe", "pipe", "pipe"], // Explicitly set stdio
    });

    info.process = claudeProcess;
    info.buffer = "";

    console.log(`[Claude] Process spawned with PID: ${claudeProcess.pid}`);

    // Check if stdout/stderr are available
    if (!claudeProcess.stdout) {
      console.error(`[Claude] stdout is null!`);
      return;
    }
    if (!claudeProcess.stderr) {
      console.error(`[Claude] stderr is null!`);
      return;
    }

    // Log spawn event
    claudeProcess.on("spawn", () => {
      console.log(`[Claude] Process spawn event received`);
    });

    // Handle stdout (stream-json events)
    claudeProcess.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      console.log(`[Claude] stdout: ${chunk.substring(0, 100)}...`);
      info.buffer += chunk;

      // Process complete JSON lines
      const lines = info.buffer.split("\n");
      info.buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          this.processStreamEvent(sessionId, line);
        }
      }
    });

    // Handle stderr
    claudeProcess.stderr.on("data", (data: Buffer) => {
      console.log(`[Claude] stderr: ${data.toString()}`);
      const errorMessage: Message = {
        id: nanoid(),
        sessionId,
        role: "system",
        content: data.toString(),
        timestamp: new Date(),
        type: "error",
      };
      this.emit("message:received", errorMessage);
    });

    // Handle process exit
    claudeProcess.on("close", (code) => {
      console.log(`[Claude] Process exited with code: ${code}`);
      // Process any remaining buffer
      if (info.buffer.trim()) {
        this.processStreamEvent(sessionId, info.buffer);
      }

      info.session.status = code === 0 ? "idle" : "error";
      this.emit("session:updated", info.session);
      this.emit("message:complete", { sessionId, messageId: nanoid() });
    });

    // Handle process error
    claudeProcess.on("error", (error) => {
      console.error(`[Claude] Process error: ${error.message}`);
      const errorMessage: Message = {
        id: nanoid(),
        sessionId,
        role: "system",
        content: `Failed to start Claude Code: ${error.message}`,
        timestamp: new Date(),
        type: "error",
      };
      this.emit("message:received", errorMessage);
      
      info.session.status = "error";
      this.emit("session:updated", info.session);
    });
  }

  // Process a stream-json event
  private processStreamEvent(sessionId: string, line: string): void {
    try {
      const event: ClaudeStreamEvent = JSON.parse(line);
      
      // Handle different event types
      switch (event.type) {
        case "assistant":
          if (event.subtype === "text") {
            this.emit("message:stream", {
              sessionId,
              chunk: event.content || "",
              type: "text",
            });
          }
          break;

        case "tool_use":
          const toolMessage: Message = {
            id: nanoid(),
            sessionId,
            role: "assistant",
            content: `Using tool: ${event.tool_name}\n${JSON.stringify(event.tool_input, null, 2)}`,
            timestamp: new Date(),
            type: "tool_use",
          };
          this.emit("message:received", toolMessage);
          break;

        case "tool_result":
          const resultMessage: Message = {
            id: nanoid(),
            sessionId,
            role: "system",
            content: event.result || "",
            timestamp: new Date(),
            type: "tool_result",
          };
          this.emit("message:received", resultMessage);
          break;

        case "result":
          // Final result
          const finalMessage: Message = {
            id: nanoid(),
            sessionId,
            role: "assistant",
            content: event.content || "",
            timestamp: new Date(),
            type: "text",
          };
          this.emit("message:received", finalMessage);
          break;

        case "error":
          const errorMessage: Message = {
            id: nanoid(),
            sessionId,
            role: "system",
            content: event.error || "Unknown error",
            timestamp: new Date(),
            type: "error",
          };
          this.emit("message:received", errorMessage);
          break;
      }
    } catch (e) {
      // Not valid JSON, might be plain text output
      this.emit("message:stream", {
        sessionId,
        chunk: line,
        type: "text",
      });
    }
  }

  // Stop a session
  stopSession(sessionId: string): void {
    const info = this.processes.get(sessionId);
    if (!info) {
      return;
    }

    // Kill the process if running
    if (info.process && !info.process.killed) {
      info.process.kill("SIGTERM");
      
      // Force kill after timeout
      setTimeout(() => {
        if (info.process && !info.process.killed) {
          info.process.kill("SIGKILL");
        }
      }, 5000);
    }

    info.session.status = "stopped";
    this.emit("session:stopped", sessionId);
    this.processes.delete(sessionId);
  }

  // Get session info
  getSession(sessionId: string): Session | undefined {
    return this.processes.get(sessionId)?.session;
  }

  // Get all sessions
  getAllSessions(): Session[] {
    return Array.from(this.processes.values()).map((info) => info.session);
  }

  // Cleanup all sessions
  cleanup(): void {
    const sessionIds = Array.from(this.processes.keys());
    for (const sessionId of sessionIds) {
      this.stopSession(sessionId);
    }
  }
}

// Singleton instance
export const claudeManager = new ClaudeProcessManager();
