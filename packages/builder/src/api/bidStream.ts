import {ApiError} from "@lodestar/api/server";
import {ForkName} from "@lodestar/params";
import {gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BuilderApi, BuilderApiModules, BuilderApiOptions, assertValidRequestAuth, bidResponseBudgets} from "./impl.js";

export type BidStreamRequest = Parameters<BuilderApi["getExecutionPayloadBid"]>[0];
export type RetainedBidStream = {
  /** Initial monotonic send deadline, including authentication and a return-path margin. */
  deadline: number;
  /** Immutable pre-authentication bounds; a measured full RTT must still be reserved before sending. */
  hardDeadline?: {monotonic: number; unixMs: number};
  signal?: AbortSignal;
  current(): gloas.SignedExecutionPayloadBid | null;
  canOffer(bid: gloas.SignedExecutionPayloadBid): boolean;
  subscribe(notify: () => void): () => void;
};
export type BuilderBidStreamApi = {signal?: AbortSignal; open(request: BidStreamRequest): Promise<RetainedBidStream>};

/** Transport-independent access to already signed and durably retained revisions. */
export function getBuilderBidStreamApi(modules: BuilderApiModules, opts: BuilderApiOptions): BuilderBidStreamApi {
  const {bidStore, clock, config, signal} = modules;
  return {
    signal,
    async open({slot, parentHash, parentRoot, proposerPubkey, requestAuth, dateMilliseconds, timeoutMs}) {
      if (signal?.aborted) throw new ApiError(503, "Builder is stopping");
      if (config.getForkName(slot) !== ForkName.gloas) throw new ApiError(400, "Bid stream requires Gloas");
      const started = performance.now();
      const arrivedAt = Date.now();
      const {waitMs, hardStopMs} = bidResponseBudgets(clock, config, slot, arrivedAt - dateMilliseconds, timeoutMs);
      if (requestAuth.message.slot !== slot) throw new ApiError(400, "Request auth slot does not match bid slot");
      await assertValidRequestAuth(modules, opts, requestAuth, proposerPubkey);
      if (signal?.aborted) throw new ApiError(503, "Builder is stopping");
      const parentBlockHash = toRootHex(parentHash);
      const parentBlockRoot = toRootHex(parentRoot);
      return {
        deadline: started + waitMs,
        hardDeadline: {monotonic: started + hardStopMs, unixMs: arrivedAt + hardStopMs},
        signal,
        current: () => bidStore.get(slot, parentBlockHash, parentBlockRoot),
        canOffer: (bid) => !signal?.aborted && bidStore.canOffer(bid),
        subscribe: (notify) => bidStore.subscribe(slot, parentBlockHash, parentBlockRoot, notify),
      };
    },
  };
}
