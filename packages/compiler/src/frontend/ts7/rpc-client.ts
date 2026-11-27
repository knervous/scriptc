// This file was modified from scriptc (Apache-2.0); see MODIFICATIONS.md.
import {
  TS7_CALLBACK, TS7_CALLBACK_ERROR, TS7_CALLBACK_RESPONSE, TS7_ERROR,
  TS7_REQUEST, TS7_RESPONSE, Ts7ProtocolError, Ts7Wire,
} from "./rpc-wire.js";

export interface Ts7RpcTiming {
  requests: number;
  bytesSent: number;
  bytesReceived: number;
  callbacks: number;
}

interface Ts7Callback {
  invoke: (payload: string) => string;
}

/** The wire protocol is strictly synchronous and has no request ids. A
 * callback must answer the current request; starting a nested request on
 * that channel would consume the outer response under the wrong call. */
export class Ts7RpcClient {
  private readonly callbacks = new Map<string, Ts7Callback>();
  private requesting = false;
  private closed = false;
  private requests = 0;
  private bytesSent = 0;
  private bytesReceived = 0;
  private callbackCount = 0;

  constructor(private readonly wire: Ts7Wire) {}

  registerCallback(name: string, callback: (payload: string) => string): void {
    if (this.closed) throw new Ts7ProtocolError("client is closed");
    if (this.requesting) throw new Ts7ProtocolError("cannot replace callbacks during a request");
    this.callbacks.set(name, { invoke: callback });
  }

  timing(): Ts7RpcTiming {
    return { requests: this.requests, bytesSent: this.bytesSent, bytesReceived: this.bytesReceived, callbacks: this.callbackCount };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.callbacks.clear();
    this.wire.close();
  }

  private call(method: string, payload: Uint8Array): void {
    const callback = this.callbacks.get(method);
    if (callback === undefined) {
      const message = `unknown callback: ${method}`;
      this.wire.write(TS7_CALLBACK_ERROR, method, Buffer.from(message, "utf8"));
      throw new Ts7ProtocolError(message);
    }
    this.callbackCount++;
    let response: string;
    try {
      response = callback.invoke(Buffer.from(payload).toString("utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.wire.write(TS7_CALLBACK_ERROR, method, Buffer.from(message, "utf8"));
      throw new Ts7ProtocolError(`callback ${method} failed: ${message}`);
    }
    this.wire.write(TS7_CALLBACK_RESPONSE, method, Buffer.from(response, "utf8"));
  }

  requestBytes(method: string, payload: Uint8Array): Uint8Array {
    if (this.closed) throw new Ts7ProtocolError("client is closed");
    if (this.requesting) throw new Ts7ProtocolError("reentrant requests are not supported");
    this.requesting = true;
    try {
      this.wire.write(TS7_REQUEST, method, payload);
      this.requests++;
      this.bytesSent += payload.length;
      for (;;) {
        const message = this.wire.read();
        if (message.kind === TS7_CALLBACK) {
          this.call(message.method, message.payload);
          continue;
        }
        if (message.kind !== TS7_RESPONSE && message.kind !== TS7_ERROR) {
          throw new Ts7ProtocolError(`unexpected server message ${message.kind}`);
        }
        if (message.method !== method) {
          throw new Ts7ProtocolError(`response method mismatch: expected ${method}, received ${message.method}`);
        }
        this.bytesReceived += message.payload.length;
        if (message.kind === TS7_ERROR) {
          // A server error is a complete response. Keep this channel usable
          // for panic-fenced checker batches and subsequent valid requests.
          this.requesting = false;
          throw new Error(Buffer.from(message.payload).toString("utf8"));
        }
        return message.payload;
      }
    } catch (error) {
      if (this.requesting) {
        try { this.close(); } catch { /* preserve the request failure */ }
      }
      throw error;
    } finally {
      this.requesting = false;
    }
  }

  /** Several requests written back to back and their responses read in order, so the round trips overlap: the server
   * answers one request while the next is already in its pipe (about 3-5 us a request instead of 12-14 for small
   * checker queries). Requests go in windows small enough for the pipe's buffer, so neither side blocks writing, and
   * no larger than the transport's pipelineDepth (1 on Windows: nothing is written ahead). Each result is the response
   * bytes or the server's error. Only for checker queries: a server callback here (it would read the next queued
   * request as the callback's answer) closes the channel. */
  requestBytesPipelined(requests: readonly { method: string; payload: Uint8Array }[]): (Uint8Array | Error)[] {
    if (this.closed) throw new Ts7ProtocolError("client is closed");
    if (this.requesting) throw new Ts7ProtocolError("reentrant requests are not supported");
    this.requesting = true;
    const results: (Uint8Array | Error)[] = [];
    const depth = Math.max(1, Math.min(64, this.wire.pipelineDepth ?? 64));
    try {
      for (let at = 0; at < requests.length;) {
        let end = at, bytes = 0;
        while (end < requests.length && end - at < depth && (end === at || bytes + requests[end]!.payload.length < 16384)) bytes += requests[end++]!.payload.length + 64;
        for (let i = at; i < end; i++) {
          this.wire.write(TS7_REQUEST, requests[i]!.method, requests[i]!.payload);
          this.requests++;
          this.bytesSent += requests[i]!.payload.length;
        }
        for (let i = at; i < end; i++) {
          const message = this.wire.read();
          if (message.kind === TS7_CALLBACK) throw new Ts7ProtocolError(`server callback ${message.method} during a pipelined batch`);
          if (message.kind !== TS7_RESPONSE && message.kind !== TS7_ERROR) throw new Ts7ProtocolError(`unexpected server message ${message.kind}`);
          if (message.method !== requests[i]!.method) throw new Ts7ProtocolError(`response method mismatch: expected ${requests[i]!.method}, received ${message.method}`);
          this.bytesReceived += message.payload.length;
          results.push(message.kind === TS7_ERROR ? new Error(Buffer.from(message.payload).toString("utf8")) : message.payload);
        }
        at = end;
      }
      return results;
    } catch (error) {
      try { this.close(); } catch { /* preserve the failure */ }
      throw error;
    } finally {
      this.requesting = false;
    }
  }

  requestText(method: string, payload: string): string {
    return Buffer.from(this.requestBytes(method, Buffer.from(payload, "utf8"))).toString("utf8");
  }
}
