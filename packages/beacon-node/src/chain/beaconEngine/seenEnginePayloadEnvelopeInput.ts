import {ChainForkConfig} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkPostGloas, SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, gloas, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {IBeaconEngineDb} from "../../db/interface.js";
import {MAX_LOOK_AHEAD_EPOCHS} from "../../sync/constants.js";
import {
  CreateEnginePayloadEnvelopeInputFromBidProps,
  CreateEnginePayloadEnvelopeInputFromBlockProps,
  EnginePayloadEnvelopeInput,
} from "./enginePayloadEnvelopeInput.js";

const MAX_PAYLOAD_ENVELOPE_INPUT_CACHE_SIZE = (MAX_LOOK_AHEAD_EPOCHS + 1) * SLOTS_PER_EPOCH;

type SeenEnginePayloadEnvelopeInputModules = {
  config: ChainForkConfig;
  forkChoice: Pick<IForkChoice, "hasBlockHex" | "isDescendant" | "getFinalizedCheckpoint">;
  db: {block: Pick<IBeaconEngineDb["block"], "get">};
};

/**
 * Source: unstable@0edec865c8 chain/seenCache/seenPayloadEnvelopeInput.ts.
 * Retains consensus validation context independently of the facade's DA lifecycle.
 */
export class SeenEnginePayloadEnvelopeInput {
  private readonly payloadInputs = new Map<RootHex, EnginePayloadEnvelopeInput>();
  private readonly reloading = new Map<RootHex, Promise<EnginePayloadEnvelopeInput | undefined>>();

  constructor(private readonly modules: SeenEnginePayloadEnvelopeInputModules) {}

  add(props: CreateEnginePayloadEnvelopeInputFromBlockProps): EnginePayloadEnvelopeInput {
    const existing = this.payloadInputs.get(props.blockRootHex);
    if (existing) return existing;
    const input = EnginePayloadEnvelopeInput.createFromBlock(props);
    this.payloadInputs.set(props.blockRootHex, input);
    this.pruneToMaxSize();
    return input;
  }

  addFromBid(props: CreateEnginePayloadEnvelopeInputFromBidProps): EnginePayloadEnvelopeInput {
    const existing = this.payloadInputs.get(props.blockRootHex);
    if (existing) return existing;
    const input = EnginePayloadEnvelopeInput.createFromBid(props);
    this.payloadInputs.set(props.blockRootHex, input);
    this.pruneToMaxSize();
    return input;
  }

  get(blockRootHex: RootHex): EnginePayloadEnvelopeInput | undefined {
    return this.payloadInputs.get(blockRootHex);
  }

  remove(blockRootHex: RootHex): void {
    this.payloadInputs.delete(blockRootHex);
  }

  async getOrReload(blockRootHex: RootHex): Promise<EnginePayloadEnvelopeInput | undefined> {
    const existing = this.payloadInputs.get(blockRootHex);
    if (existing) return existing;
    const inflight = this.reloading.get(blockRootHex);
    if (inflight !== undefined) return inflight;
    const promise = this.reloadFromDb(blockRootHex);
    this.reloading.set(blockRootHex, promise);
    try {
      return await promise;
    } finally {
      this.reloading.delete(blockRootHex);
    }
  }

  private async reloadFromDb(blockRootHex: RootHex): Promise<EnginePayloadEnvelopeInput | undefined> {
    const {config, forkChoice, db} = this.modules;
    if (!forkChoice.hasBlockHex(blockRootHex)) return undefined;
    const block = await db.block.get(fromHex(blockRootHex));
    if (!block) return undefined;
    const forkName = config.getForkName(block.message.slot);
    if (
      !isForkPostGloas(forkName) ||
      !forkChoice.hasBlockHex(blockRootHex) ||
      block.message.slot < computeStartSlotAtEpoch(forkChoice.getFinalizedCheckpoint().epoch)
    ) {
      return undefined;
    }
    return this.add({blockRootHex, block: block as SignedBeaconBlock<ForkPostGloas>, forkName});
  }

  removeInvalid(envelope: gloas.SignedExecutionPayloadEnvelope): void {
    const blockRootHex = toRootHex(envelope.message.beaconBlockRoot);
    const input = this.payloadInputs.get(blockRootHex);
    if (
      input?.hasPayloadEnvelope() &&
      ssz.gloas.SignedExecutionPayloadEnvelope.equals(input.getPayloadEnvelope(), envelope)
    ) {
      this.payloadInputs.delete(blockRootHex);
    }
  }

  pruneFinalized(checkpoint: CheckpointWithHex): void {
    const finalizedSlot = computeStartSlotAtEpoch(checkpoint.epoch);
    for (const [root, input] of this.payloadInputs) {
      if (input.slot < finalizedSlot) this.payloadInputs.delete(root);
    }
  }

  pruneBelowParent(parentBlock: ProtoBlock): void {
    for (const [root, input] of this.payloadInputs) {
      if (
        input.slot < parentBlock.slot &&
        this.modules.forkChoice.isDescendant(root, PayloadStatus.FULL, parentBlock.blockRoot, parentBlock.payloadStatus)
      ) {
        this.payloadInputs.delete(root);
      }
    }
  }

  size(): number {
    return this.payloadInputs.size;
  }

  private pruneToMaxSize(): void {
    for (const root of this.payloadInputs.keys()) {
      if (this.payloadInputs.size <= MAX_PAYLOAD_ENVELOPE_INPUT_CACHE_SIZE) break;
      this.payloadInputs.delete(root);
    }
  }
}
