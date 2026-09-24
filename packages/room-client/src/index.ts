import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type RoomPublicState,
  type ServerMessage,
} from "@games/protocol";
import { PartySocket } from "partysocket";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface RoomUpdate {
  stateVersion: number;
  snapshot: boolean;
  room: RoomPublicState;
  private: unknown | null;
  events: unknown[];
}

export interface RoomClientEvents {
  status: ConnectionStatus;
  welcome: { playerId: string; resumeToken: string };
  update: RoomUpdate;
  rejected: { clientActionId: string; code: string; message: string };
  /** Non-fatal server error, e.g. "not-host". */
  error: { code: ErrorCode; message: string };
  /** The server closed us for good; auto-reconnect is off. */
  fatal: { code: ErrorCode; message: string };
  nudged: { byPlayerId: string };
}

export interface RoomClientOptions {
  code: string;
  name: string;
  avatarSeed: string;
  /** Read on every (re)connect, so a token issued mid-session is used next time. */
  getResumeToken(): string | undefined;
  host?: string;
}

type Listener<T> = (payload: T) => void;

const PING_EVERY_MS = 20_000;

/**
 * One room connection. Replays hello + join on every reconnect, drops stale
 * updates by stateVersion (§19) and stops reconnecting after fatal errors.
 */
export class RoomClient {
  status: ConnectionStatus = "connecting";
  playerId: string | null = null;
  /** serverTime − local time, from the last pong. For §12.2 thresholds. */
  clockOffset = 0;

  private socket: PartySocket;
  private lastVersion = -1;
  private listeners = new Map<keyof RoomClientEvents, Set<Listener<never>>>();
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private actionSeq = 0;
  private opts: RoomClientOptions;

  constructor(opts: RoomClientOptions) {
    this.opts = opts;
    this.socket = new PartySocket({
      host: opts.host ?? window.location.host,
      party: "room",
      room: opts.code,
    });
    this.socket.addEventListener("open", this.onOpen);
    this.socket.addEventListener("message", this.onMessage);
    this.socket.addEventListener("close", this.onClose);
  }

  on<K extends keyof RoomClientEvents>(event: K, fn: Listener<RoomClientEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  send(msg: ClientMessage): void {
    if (this.status === "open") this.socket.send(JSON.stringify(msg));
  }

  /** Sends a game action; returns its id so a rejection can be matched to the tap. */
  act(action: unknown): string {
    const clientActionId = `${Date.now().toString(36)}-${(this.actionSeq++).toString(36)}`;
    this.send({ type: "game-action", clientActionId, action });
    return clientActionId;
  }

  /** Reconnect after a fatal close, e.g. the "Use here" button (§11). */
  reconnect(): void {
    this.lastVersion = -1;
    this.setStatus("connecting");
    this.socket.reconnect();
  }

  close(): void {
    clearInterval(this.pingTimer);
    this.socket.removeEventListener("open", this.onOpen);
    this.socket.removeEventListener("message", this.onMessage);
    this.socket.removeEventListener("close", this.onClose);
    this.socket.close();
    this.setStatus("closed");
  }

  // ---- socket handlers ----------------------------------------------------

  private onOpen = () => {
    this.setStatus("open");
    // Every connection gets a fresh snapshot, so forget the old version.
    this.lastVersion = -1;
    this.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    const resumeToken = this.opts.getResumeToken();
    this.send({
      type: "join",
      name: this.opts.name,
      avatarSeed: this.opts.avatarSeed,
      ...(resumeToken && { resumeToken }),
    });
    clearInterval(this.pingTimer);
    this.ping();
    this.pingTimer = setInterval(this.ping, PING_EVERY_MS);
  };

  private onClose = () => {
    clearInterval(this.pingTimer);
    if (this.status !== "closed") this.setStatus("reconnecting");
  };

  private onMessage = (e: MessageEvent) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data as string) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "welcome":
        this.playerId = msg.playerId;
        this.emit("welcome", msg);
        break;
      case "update":
        if (msg.stateVersion <= this.lastVersion) return;
        this.lastVersion = msg.stateVersion;
        this.emit("update", msg);
        break;
      case "action-rejected":
        this.emit("rejected", msg);
        break;
      case "nudged":
        this.emit("nudged", msg);
        break;
      case "pong":
        this.clockOffset = msg.serverTime - (msg.timestamp + Date.now()) / 2;
        break;
      case "error":
        if (msg.fatal) {
          // Stop PartySocket's auto-reconnect before the server's close lands (§11).
          clearInterval(this.pingTimer);
          this.socket.close();
          this.setStatus("closed");
          this.emit("fatal", msg);
        } else {
          this.emit("error", msg);
        }
        break;
    }
  };

  private ping = () => this.send({ type: "ping", timestamp: Date.now() });

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }

  private emit<K extends keyof RoomClientEvents>(event: K, payload: RoomClientEvents[K]) {
    for (const fn of this.listeners.get(event) ?? []) (fn as Listener<RoomClientEvents[K]>)(payload);
  }
}
