import {routes} from "@lodestar/api";
import type {ChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {type IClock, computeEpochAtSlot, computeTimeAtSlot} from "@lodestar/state-transition";
import {type ExecutionAddress, type gloas, ssz} from "@lodestar/types";
import {ErrorAborted, LodestarError, toHex, toRootHex} from "@lodestar/utils";
import type {ProposerPreferencesTracker} from "./proposerPreferencesTracker.js";
import type {SlotBidResult, SlotBidder} from "./slotBidder.js";

type Head = routes.events.EventData[routes.events.EventType.headV2]["data"];
type ConsumerResult = SlotBidResult | {status: "ignored"; reason: string};

export type PayloadAttributesConsumerModules = {
  config: ChainForkConfig;
  clock: IClock;
  preferences: Pick<ProposerPreferencesTracker, "get">;
  bidder: Pick<SlotBidder, "run">;
};

export type PayloadAttributesConsumerOptions = {
  executionFeeRecipient: ExecutionAddress;
  /** Retrieval point in the slot before proposalSlot, not the payload reveal deadline. */
  deadlineBps: number;
  maxInputsPerSlot: number;
};

/** Head-only Gloas consumer requiring branch-correlated finality hashes in the event. */
export class PayloadAttributesConsumer {
  private head: Head | undefined;
  private pending: gloas.SSEPayloadAttributes | undefined;
  private slot = -1;
  private closed = false;
  private readonly seen = new Set<string>();
  private active: {id: string; controller: AbortController; promise: Promise<ConsumerResult>} | undefined;

  constructor(
    private readonly modules: PayloadAttributesConsumerModules,
    private readonly options: PayloadAttributesConsumerOptions
  ) {
    if (
      !Number.isSafeInteger(options.deadlineBps) ||
      options.deadlineBps <= 0 ||
      options.deadlineBps >= 10_000 ||
      !Number.isSafeInteger(options.maxInputsPerSlot) ||
      options.maxInputsPerSlot < 1 ||
      options.executionFeeRecipient.length !== 20
    ) {
      throw new LodestarError({code: "PAYLOAD_INPUT_INVALID_OPTIONS"});
    }
  }

  /** The shared dispatcher must insert proposer preferences into its tracker before calling this method. */
  async onEvent(event: routes.events.BeaconEvent, signal: AbortSignal): Promise<ConsumerResult> {
    signal.throwIfAborted();
    if (this.closed) return {status: "ignored", reason: "closed"};
    this.onSlot(this.modules.clock.getCurrentSlot());
    if (event.type === routes.events.EventType.headV2) {
      const {version, data} = event.message;
      if (this.modules.config.getForkName(data.slot) !== version || data.slot > this.slot) {
        return {status: "ignored", reason: "invalid_head"};
      }
      if (this.head?.block !== data.block)
        this.active?.controller.abort(new ErrorAborted("Payload input head changed"));
      this.head = {...data};
    } else if (event.type === routes.events.EventType.payloadAttributes) {
      const {version, data} = event.message;
      if (
        version !== ForkName.gloas ||
        this.modules.config.getForkName(data.proposalSlot) !== ForkName.gloas ||
        !("slotNumber" in data.payloadAttributes)
      ) {
        return {status: "ignored", reason: "unsupported_fork"};
      }
      if (data.proposalSlot !== this.slot + 1) return {status: "ignored", reason: "outside_next_slot"};
      if (
        data.payloadAttributes.slotNumber !== data.proposalSlot ||
        toRootHex(data.payloadAttributes.parentBeaconBlockRoot) !== toRootHex(data.parentBlockRoot) ||
        data.payloadAttributes.timestamp !==
          computeTimeAtSlot(this.modules.config, data.proposalSlot, this.modules.clock.genesisTime) ||
        !("safeBlockHash" in data) ||
        !("finalizedBlockHash" in data)
      ) {
        return {status: "ignored", reason: "invalid_attributes"};
      }
      this.pending = ssz.gloas.SSEPayloadAttributes.clone(data);
    } else if (event.type !== routes.events.EventType.proposerPreferences) {
      return {status: "ignored", reason: "unrelated_event"};
    }
    return this.tryBuild(signal);
  }

  onSlot(slot: number): void {
    if (slot === this.slot) return;
    this.active?.controller.abort(new ErrorAborted("Payload input slot changed"));
    this.active = undefined;
    this.pending = undefined;
    this.seen.clear();
    this.slot = slot;
  }

  onDisconnect(): void {
    this.active?.controller.abort(new ErrorAborted("Payload input connection lost"));
    this.active = undefined;
    this.pending = undefined;
    this.head = undefined;
  }

  async onPreferences(signal: AbortSignal): Promise<ConsumerResult> {
    signal.throwIfAborted();
    if (this.closed) return {status: "ignored", reason: "closed"};
    this.onSlot(this.modules.clock.getCurrentSlot());
    return this.tryBuild(signal);
  }

  close(): void {
    this.closed = true;
    this.active?.controller.abort(new ErrorAborted("Payload input consumer closed"));
    this.active = undefined;
    this.pending = undefined;
    this.head = undefined;
    this.seen.clear();
  }

  private async tryBuild(signal: AbortSignal): Promise<ConsumerResult> {
    const data = this.pending;
    const head = this.head;
    if (!data || !head || toRootHex(data.parentBlockRoot) !== head.block) {
      return {status: "ignored", reason: "awaiting_matching_head"};
    }
    const {config, clock, preferences, bidder} = this.modules;
    const epochDifference = computeEpochAtSlot(data.proposalSlot) - computeEpochAtSlot(head.slot);
    if (epochDifference !== 0 && epochDifference !== 1) {
      return {status: "ignored", reason: "unsupported_head_epoch"};
    }
    const dependentRoot = epochDifference === 0 ? head.currentEpochDependentRoot : head.nextEpochDependentRoot;
    const preference = preferences.get(data.proposalSlot, dependentRoot);
    if (!preference) return {status: "ignored", reason: "awaiting_preference"};
    if (
      preference.message.validatorIndex !== data.proposerIndex ||
      preference.message.targetGasLimit !== data.payloadAttributes.targetGasLimit
    ) {
      return {status: "ignored", reason: "preference_mismatch"};
    }

    const getPayloadAt =
      Date.now() +
      clock.msToSlot(data.proposalSlot) -
      config.SLOT_DURATION_MS +
      config.getSlotComponentDurationMs(this.options.deadlineBps);
    if (getPayloadAt <= Date.now()) return {status: "ignored", reason: "deadline_passed"};
    const id = JSON.stringify(ssz.gloas.SSEPayloadAttributes.toJson(data));
    if (this.active?.id === id && !this.active.controller.signal.aborted) return this.active.promise;
    if (this.seen.has(id)) return {status: "ignored", reason: "duplicate_input"};
    if (this.seen.size >= this.options.maxInputsPerSlot) return {status: "ignored", reason: "input_limit"};

    this.active?.controller.abort(new ErrorAborted("Payload input replaced"));
    const controller = new AbortController();
    const jobSignal = AbortSignal.any([signal, controller.signal]);
    const payloadAttributes = ssz.gloas.PayloadAttributes.clone(data.payloadAttributes);
    payloadAttributes.suggestedFeeRecipient = toHex(this.options.executionFeeRecipient);
    this.seen.add(id);
    const promise = bidder
      .run(
        {
          fork: ForkName.gloas,
          slot: data.proposalSlot,
          parentBlockRoot: data.parentBlockRoot,
          proposerFeeRecipient: preference.message.feeRecipient,
          job: {
            id,
            getPayloadAt,
            request: {
              fork: ForkName.gloas,
              forkchoiceState: {
                headBlockHash: toRootHex(data.parentBlockHash),
                safeBlockHash: toRootHex(data.safeBlockHash),
                finalizedBlockHash: toRootHex(data.finalizedBlockHash),
              },
              payloadAttributes,
            },
          },
        },
        jobSignal
      )
      .then((result) => {
        jobSignal.throwIfAborted();
        return result;
      });
    this.active = {id, controller, promise};
    try {
      return await promise;
    } finally {
      if (this.active?.controller === controller) this.active = undefined;
    }
  }
}
