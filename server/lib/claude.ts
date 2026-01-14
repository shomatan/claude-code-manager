/**
 * Claude Code Process Manager
 * 
 * Manages Claude Code CLI processes for each session.
 * Uses macOS `script` command for TTY emulation and stream-json output format.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import * as os from "os";
import * as path from "path";
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

    // Use CLAUDE_PATH env var or try common locations
    let claudePath = process.env.CLAUDE_PATH;
    if (!claudePath) {
      const commonPaths = [
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
        "/usr/bin/claude",
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          claudePath = p;
          break;
        }
      }
    }
    if (!claudePath) {
      claudePath = "claude"; // Fallback to PATH lookup
    }
    console.log(`[Claude] Using claude path: ${claudePath}`);

    // Build the claude command
    const claudeArgs = [
      "-p", message,
      "--output-format", "stream-json",
      "--verbose",
    ];
    
    // Create a temporary file for script output
    const tmpFile = path.join(os.tmpdir(), `claude-${sessionId}.log`);
    
    // Use `script` command to create a PTY
    // macOS: script -q /dev/null command args...
    // Linux: script -q -c "command args..." /dev/null
    const isMac = os.platform() === "darwin";
    
    let scriptArgs: string[];
    if (isMac) {
      // macOS script syntax: script -q output_file command [args...]
      scriptArgs = ["-q", "/dev/null", claudePath, ...claudeArgs];
    } else {
      // Linux script syntax: script -q -c "command" output_file
      const fullCommand = [claudePath, ...claudeArgs].map(arg => 
        arg.includes(" ") ? `"${arg}"` : arg
      ).join(" ");
      scriptArgs = ["-q", "-c", fullCommand, "/dev/null"];
    }
    
    console.log(`[Claude] Spawning with script: script ${scriptArgs.join(" ")}`);

    try {
      const scriptProcess = spawn("script", scriptArgs, {
        cwd: info.session.worktreePath,
        env: {
          ...process.env,
          CI: "true",
          TERM: "xterm-256color",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      info.process = scriptProcess;
      info.buffer = "";

      console.log(`[Claude] Process spawned with PID: ${scriptProcess.pid}`);

      // Handle stdout
      scriptProcess.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        console.log(`[Claude] stdout: ${chunk.substring(0, 100)}...`);
        info.buffer += chunk;

        // Process complete JSON lines
        const lines = info.buffer.split("\n");
        info.buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();
          // Remove ANSI escape codes
          const cleanLine = trimmedLine.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
          if (cleanLine) {
            this.processStreamEvent(sessionId, cleanLine);
          }
        }
      });

      // Handle stderr
      scriptProcess.stderr?.on("data", (data: Buffer) => {
        console.log(`[Claude] stderr: ${data.toString()}`);
      });

      // Handle process exit
      scriptProcess.on("close", (code) => {
        console.log(`[Claude] Process exited with code: ${code}`);
        
        // Process any remaining buffer
        if (info.buffer.trim()) {
          const cleanBuffer = info.buffer.trim().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
          if (cleanBuffer) {
            this.processStreamEvent(sessionId, cleanBuffer);
          }
        }

        info.session.status = code === 0 ? "idle" : "error";
        this.emit("session:updated", info.session);
        this.emit("message:complete", { sessionId, messageId: nanoid() });
      });

      // Handle process error
      scriptProcess.on("error", (error) => {
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
      // Not valid JSON, might be plain text output or script noise
      // Only emit if it looks like actual content
      if (line.length > 2 && !line.startsWith("Script ")) {
        console.log(`[Claude] Non-JSON line: ${line.substring(0, 50)}...`);
        this.emit("message:stream", {
          sessionId,
          chunk: line,
          type: "text",
        });
      }
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
