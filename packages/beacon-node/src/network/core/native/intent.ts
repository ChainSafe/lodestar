import {NativeLocalIntent, NativeNetwork} from "@chainsafe/lodestar-z/network";
import {Status} from "@lodestar/types";
import {CommitteeSubscription} from "../../subnets/interface.js";
import {normalizeCommitteeSubscriptions} from "./committee.js";
import {nativeStatus} from "./config.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

/** Serializes state updates so subscription observations follow native application order. */
export class NativeIntent {
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  private subscribed = false;
  constructor(private readonly runtime: Pick<NativeNetwork, "applyIntent" | "updateStatus">) {}

  updateStatus(status: Status): Promise<void> {
    return this.enqueue({status: nativeStatus(status)});
  }
  coreTopics(enabled: boolean): Promise<void> {
    return this.enqueue({coreTopics: enabled});
  }
  isSubscribedToCoreTopics(): boolean {
    return !this.closed && this.subscribed;
  }
  custody(count: number): Promise<void> {
    return this.enqueue({custodyGroupCount: BigInt(nativeInteger(count, "custody count", undefined, 1))});
  }
  committee(subscriptions: CommitteeSubscription[], sync: boolean): Promise<void> {
    const demand = normalizeCommitteeSubscriptions(subscriptions, sync);
    return this.enqueue({
      attesters: [...demand.attesters.values()],
      syncCommittees: [...demand.sync].map(([subnet, untilSlot]) => ({subnet, untilSlot})),
    });
  }
  private enqueue(patch: NativeLocalIntent): Promise<void> {
    const next = this.pending.then(async () => {
      if (this.closed) throw new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "local intent"});
      if (patch.status && Object.keys(patch).length === 1) await this.runtime.updateStatus(patch.status);
      else await this.runtime.applyIntent(patch);
      if (!this.closed && patch.coreTopics !== undefined) this.subscribed = patch.coreTopics;
    });
    this.pending = next.catch(() => undefined);
    return next;
  }
  close(): void {
    this.closed = true;
  }
}
