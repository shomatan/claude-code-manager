/**
 * Claude Code Process Manager
 * 
 * Manages Claude Code CLI processes for each session.
 * Uses stream-json output format for structured responses.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import * as fs from "fs";
import type { Session, Message, ClaudeStreamEvent } from "../../shared/types.js";

interface ProcessInfo {
  process: ChildProcess | null;
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
      process: null,
      session,
      buffer: "",
    });

    this.emit("session:created", session);
    return session;
  }

  // Check if unbuffer command exists
  private checkUnbufferExists(): boolean {
    const commonPaths = [
      "/opt/homebrew/bin/unbuffer",
      "/usr/local/bin/unbuffer",
      "/usr/bin/unbuffer",
    ];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        return true;
      }
    }
    return false;
  }

  // Find claude executable path
  private findClaudePath(): string {
    // Use CLAUDE_PATH env var if set
    if (process.env.CLAUDE_PATH) {
      return process.env.CLAUDE_PATH;
    }
    
    // Try common locations
    const commonPaths = [
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/usr/bin/claude",
    ];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    
    // Fallback to PATH lookup
    return "claude";
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

    const claudePath = this.findClaudePath();
    console.log(`[Claude] Using claude path: ${claudePath}`);

    // Build arguments array for claude
    const claudeArgs = [
      "-p", message,
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions", // Skip trust prompts for non-interactive use
    ];
    
    // Use unbuffer to emulate TTY (required for Claude CLI to output properly)
    // unbuffer is part of the 'expect' package
    const useUnbuffer = this.checkUnbufferExists();
    const command = useUnbuffer ? "unbuffer" : claudePath;
    const args = useUnbuffer ? [claudePath, ...claudeArgs] : claudeArgs;
    
    console.log(`[Claude] Spawning: ${command} ${args.join(" ")}`);

    try {
      const claudeProcess = spawn(command, args, {
        cwd: info.session.worktreePath,
        env: {
          ...process.env,
          CI: "true",
          TERM: "xterm-256color",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      info.process = claudeProcess;
      info.buffer = "";

      console.log(`[Claude] Process spawned with PID: ${claudeProcess.pid}`);

      // Handle stdout
      claudeProcess.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        console.log(`[Claude] stdout: ${chunk.substring(0, 200)}...`);
        info.buffer += chunk;

        // Process complete JSON lines
        const lines = info.buffer.split("\n");
        info.buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine) {
            this.processStreamEvent(sessionId, trimmedLine);
          }
        }
      });

      // Handle stderr
      claudeProcess.stderr?.on("data", (data: Buffer) => {
        console.log(`[Claude] stderr: ${data.toString()}`);
      });

      // Handle process exit
      claudeProcess.on("close", (code) => {
        console.log(`[Claude] Process exited with code: ${code}`);
        
        // Process any remaining buffer
        if (info.buffer.trim()) {
          this.processStreamEvent(sessionId, info.buffer.trim());
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

    } catch (error) {
      console.error(`[Claude] Failed to spawn process: ${error}`);
      const errorMessage: Message = {
        id: nanoid(),
        sessionId,
        role: "system",
        content: `Failed to start Claude Code: ${error}`,
        timestamp: new Date(),
        type: "error",
      };
      this.emit("message:received", errorMessage);
      
      info.session.status = "error";
      this.emit("session:updated", info.session);
    }
  }

  // Process a stream-json event
  private processStreamEvent(sessionId: string, line: string): void {
    try {
      const event: ClaudeStreamEvent = JSON.parse(line);
      console.log(`[Claude] Event type: ${event.type}`);
      
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
      console.log(`[Claude] Non-JSON line: ${line.substring(0, 50)}...`);
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
