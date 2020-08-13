import { EventEmitter } from "events";
import { IGossipSub } from "../../../src/network/gossip/interface";

export class MockGossipSub extends EventEmitter implements IGossipSub {
  subscriptions: Set<string>;
  public async publish(topic: string, data: Buffer): Promise<void> {
  }

  public async start(): Promise<void> {
  }

  public async stop(): Promise<void> {
  }

  public subscribe(topic: string): void {
  }

  public unsubscribe(topic: string): void {
  }

}