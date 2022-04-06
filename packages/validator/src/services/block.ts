import {BLSPubkey, Slot} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ForkName} from "@chainsafe/lodestar-params";
import {prettyBytes} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "@chainsafe/lodestar-api";
import {IClock, extendError, ILoggerVc} from "../util/index.js";
import {ValidatorStore} from "./validatorStore.js";
import {BlockDutiesService, GENESIS_SLOT} from "./blockDuties.js";
import {PubkeyHex} from "../types.js";

/**
 * Service that sets up and handles validator block proposal duties.
 */
export class BlockProposingService {
  private readonly dutiesService: BlockDutiesService;

  constructor(
    private readonly config: IChainForkConfig,
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly graffiti?: string
  ) {
    this.dutiesService = new BlockDutiesService(logger, api, clock, validatorStore, this.notifyBlockProductionFn);
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  /**
   * `BlockDutiesService` must call this fn to trigger block creation
   * This function may run more than once at a time, rationale in `BlockDutiesService.pollBeaconProposers`
   */
  private notifyBlockProductionFn = (slot: Slot, proposers: BLSPubkey[]): void => {
    if (slot <= GENESIS_SLOT) {
      this.logger.debug("Not producing block before or at genesis slot");
      return;
    }

    if (proposers.length > 1) {
      this.logger.warn("Multiple block proposers", {slot, count: proposers.length});
    }

    Promise.all(proposers.map((pubkey) => this.createAndPublishBlock(pubkey, slot))).catch((e: Error) => {
      this.logger.error("Error on block duties", {slot}, e);
    });
  };

  /** Produce a block at the given slot for pubkey */
  private async createAndPublishBlock(pubkey: BLSPubkey, slot: Slot): Promise<void> {
    const pubkeyHex = toHexString(pubkey);
    const logCtx = {slot, validator: prettyBytes(pubkeyHex)};

    // Wrap with try catch here to re-use `logCtx`
    try {
      const randaoReveal = await this.validatorStore.signRandao(pubkey, slot);
      const graffiti = this.graffiti || "";
      const debugLogCtx = {...logCtx, validator: pubkeyHex};

      this.logger.debug("Producing block", debugLogCtx);
      const block = await this.produceBlock(slot, randaoReveal, graffiti).catch((e: Error) => {
        throw extendError(e, "Failed to produce block");
      });
      this.logger.debug("Produced block", debugLogCtx);

      const signedBlock = await this.validatorStore.signBlock(pubkey, block.data, slot);
      await this.api.beacon.publishBlock(signedBlock).catch((e: Error) => {
        throw extendError(e, "Failed to publish block");
      });
      this.logger.info("Published block", {...logCtx, graffiti});
    } catch (e) {
      this.logger.error("Error proposing block", logCtx, e as Error);
    }
  }

  /** Wrapper around the API's different methods for producing blocks across forks */
  private produceBlock: Api["validator"]["produceBlock"] = (slot, randaoReveal, graffiti) => {
    switch (this.config.getForkName(slot)) {
      case ForkName.phase0:
        return this.api.validator.produceBlock(slot, randaoReveal, graffiti);
      // All subsequent forks are expected to use v2 too
      case ForkName.altair:
      default:
        return this.api.validator.produceBlockV2(slot, randaoReveal, graffiti);
    }
  };
}
