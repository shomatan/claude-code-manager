/**
 * Authentication Module
 *
 * Simple token-based authentication for remote access.
 * Generates a random token on startup that must be included in requests.
 */

import { randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { Socket } from "socket.io";

export class AuthManager {
  private token: string;
  private enabled: boolean;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
    this.token = this.generateToken();
  }

  /**
   * Generate a random authentication token
   */
  private generateToken(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * Get the current token
   */
  getToken(): string {
    return this.token;
  }

  /**
   * Check if authentication is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable authentication
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable authentication
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Regenerate the token
   */
  regenerateToken(): string {
    this.token = this.generateToken();
    return this.token;
  }

  /**
   * Validate a token
   */
  validateToken(token: string | undefined): boolean {
    if (!this.enabled) {
      return true;
    }
    return token === this.token;
  }

  /**
   * Check if request is from localhost
   */
  private isLocalhost(host: string | undefined): boolean {
    if (!host) return false;
    const hostname = host.split(":")[0];
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  }

  /**
   * Check if path is a static asset
   */
  private isStaticAsset(path: string): boolean {
    return (
      path.startsWith("/assets/") ||
      path.endsWith(".js") ||
      path.endsWith(".css") ||
      path.endsWith(".woff") ||
      path.endsWith(".woff2") ||
      path.endsWith(".ttf") ||
      path.endsWith(".ico") ||
      path.endsWith(".svg") ||
      path.endsWith(".png") ||
      path.endsWith(".jpg")
    );
  }

  /**
   * Express middleware for HTTP authentication
   */
  httpMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!this.enabled) {
        return next();
      }

      // Skip authentication for localhost
      if (this.isLocalhost(req.headers.host)) {
        return next();
      }

      // Skip authentication for static assets
      if (this.isStaticAsset(req.path)) {
        return next();
      }

      // Check for token in query param or header
      const token =
        (req.query.token as string) || req.headers["x-auth-token"];

      if (this.validateToken(token as string)) {
        return next();
      }

      res.status(401).json({ error: "Unauthorized" });
    };
  }

  /**
   * Socket.IO middleware for WebSocket authentication
   */
  socketMiddleware() {
    return (socket: Socket, next: (err?: Error) => void) => {
      if (!this.enabled) {
        return next();
      }

      // Skip authentication for localhost
      if (this.isLocalhost(socket.handshake.headers.host)) {
        return next();
      }

      // Check for token in handshake auth or query
      const token =
        socket.handshake.auth?.token || socket.handshake.query?.token;

      if (this.validateToken(token as string)) {
        return next();
      }

      next(new Error("Authentication failed"));
    };
  }

  /**
   * Build authenticated URL
   */
  buildAuthUrl(baseUrl: string): string {
    if (!this.enabled) {
      return baseUrl;
    }
    const url = new URL(baseUrl);
    url.searchParams.set("token", this.token);
    return url.toString();
  }
}

// Singleton instance
export const authManager = new AuthManager(false);
