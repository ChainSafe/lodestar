import {NativeLocalIntent, NativeNetwork} from "@chainsafe/lodestar-z/network";
import {Status} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {CommitteeSubscription} from "../../subnets/interface.js";
import {CommitteeDemand, mergeCommitteeDemand, normalizeCommitteeSubscriptions} from "./committee.js";
import {nativeStatus} from "./config.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

type Batch = {patch: NativeLocalIntent; committee?: CommitteeDemand; completion: ReturnType<typeof defer<void>>};

/** Coalesces host changes while native owns slot progression and the applied subscription state. */
export class NativeIntent {
  private pending: Batch | undefined;
  private active: Batch | undefined;
  private scheduled = false;
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
    return this.enqueue({}, normalizeCommitteeSubscriptions(subscriptions, sync));
  }
  /** Pending updates share completion; a newer value may replace an older one before submission. */
  private enqueue(patch: NativeLocalIntent, committee?: CommitteeDemand): Promise<void> {
    if (this.closed)
      return Promise.reject(new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "local intent"}));
    const merged =
      committee && this.pending?.committee ? mergeCommitteeDemand(this.pending.committee, committee) : committee;
    this.pending ??= {patch: {}, completion: defer<void>()};
    if (merged) this.pending.committee = merged;
    Object.assign(this.pending.patch, patch);
    this.start();
    return this.pending.completion.promise;
  }
  private start(): void {
    if (this.active || this.scheduled || this.closed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.closed || this.active || !this.pending) return;
      const batch = this.pending;
      this.pending = undefined;
      this.active = batch;
      void this.run(batch).finally(() => {
        this.active = undefined;
        if (this.pending) this.start();
      });
    });
  }
  private async run(batch: Batch): Promise<void> {
    try {
      const {patch, committee} = batch;
      if (committee) {
        patch.attesters = [...committee.attesters.values()];
        patch.syncCommittees = [...committee.sync].map(([subnet, untilSlot]) => ({subnet, untilSlot}));
      }
      if (patch.status && Object.keys(patch).length === 1) await this.runtime.updateStatus(patch.status);
      else await this.runtime.applyIntent(patch);
      if (this.closed) return;
      if (patch.coreTopics !== undefined) this.subscribed = patch.coreTopics;
      batch.completion.resolve();
    } catch (error) {
      if (!this.closed) batch.completion.reject(error);
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const error = new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "local intent"});
    this.active?.completion.reject(error);
    this.pending?.completion.reject(error);
    this.pending = undefined;
  }
}
