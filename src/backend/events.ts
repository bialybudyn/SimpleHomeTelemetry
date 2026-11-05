import type { Response } from 'express';
import { WebSocket, type WebSocketServer } from 'ws';

/**
 * Rozgłaszanie zdarzeń na żywo do przeglądarek (WebSocket /ws, fallback SSE /api/events).
 */
export class EventBus {
  private sseClients = new Set<Response>();
  private wss: WebSocketServer | null = null;
  private listeners = new Set<(event: Record<string, unknown>) => void>();

  attachWebSocketServer(wss: WebSocketServer): void {
    this.wss = wss;
  }

  addSseClient(res: Response): void {
    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));
  }

  /** Lokalni słuchacze (np. automatyki, testy). */
  subscribe(listener: (event: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  broadcast(event: Record<string, unknown>): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.warn('[EVENTS] Błąd słuchacza:', err);
      }
    }
    if (this.sseClients.size === 0 && !this.wss) return;
    const json = JSON.stringify(event);
    for (const res of this.sseClients) {
      try {
        res.write(`data: ${json}\n\n`);
      } catch {
        this.sseClients.delete(res);
      }
    }
    this.wss?.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(json);
    });
  }
}
