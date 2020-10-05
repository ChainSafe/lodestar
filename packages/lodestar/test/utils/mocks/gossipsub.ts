import {EventEmitter} from "events";
import {IGossipSub} from "../../../src/network/gossip/interface";
import {Vector} from "@chainsafe/ssz";

export class MockGossipSub extends EventEmitter implements IGossipSub {
  subscriptions: Set<string> = new Set();
  public async publish(topic: string, data: Buffer): Promise<void> {}

  public async start(): Promise<void> {}

  public async stop(): Promise<void> {}

  public subscribe(topic: string): void {
    this.subscriptions.add(topic);
  }

  public unsubscribe(topic: string): void {
    this.subscriptions.delete(topic);
  }

  public emit(event: string | symbol, ...args: any[]): boolean {
    if (Array.from(this.subscriptions).includes(event as string)) {
      return super.emit(event, ...args);
    }
    return false;
  }

  public registerLibp2pTopicValidators(forkDigest: Vector<number>): void {}
}
