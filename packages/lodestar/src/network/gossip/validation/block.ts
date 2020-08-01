import {BeaconBlock, Epoch, Number64, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {
  computeStartSlotAtEpoch,
  EpochContext,
  verifyBlockSignatureFast
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ExtendedValidatorResult} from "../constants";
import {MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../constants";
import {sleep} from "../../../util/sleep";
import {toHexString} from "@chainsafe/ssz";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils";

export async function validateGossipBlock(
  config: IBeaconConfig, chain: IBeaconChain, db: IBeaconDb, logger: ILogger, signedBlock: SignedBeaconBlock
): Promise<ExtendedValidatorResult> {
  const {state, epochCtx} = await chain.getHeadStateContext();

  const blockSlot = signedBlock.message.slot;
  if (isFinalizedBlockSlot(config, blockSlot, state.finalizedCheckpoint.epoch)) {
    logger.warn("Ignoring received gossip block", {reason: "block slot is finalized", blockSlot});
    return ExtendedValidatorResult.ignore;
  }

  const disparity = getBlockTimeDisparity(config, state.genesisTime, signedBlock.message.slot);
  if (disparity > MAXIMUM_GOSSIP_CLOCK_DISPARITY) {
    if (disparity >= config.params.SECONDS_PER_SLOT * 1000) {
      logger.warn(
        "Ignoring received gossip block",
        {
          reason: "block is in the future",
          blockSlot,
          disparity,
          tolerance: MAXIMUM_GOSSIP_CLOCK_DISPARITY + "ms"
        }
      );
      return ExtendedValidatorResult.ignore;
    }
    logger.debug("Great clock disparity, waiting", {waitTime: disparity});
    // a client MAY queue future blocks for processing at the appropriate time
    await sleep(disparity);
  }
  const root = config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
  // skip block if its a known bad block
  if (await db.badBlock.has(root)) {
    logger.warn(
      "Rejecting received gossip block",
      {reason: "bad block", root: toHexString(root)}
    );
    return ExtendedValidatorResult.reject;
  }

  const existingBlock = await chain.getBlockAtSlot(blockSlot);
  if (existingBlock && existingBlock.message.proposerIndex === signedBlock.message.proposerIndex) {
    // same proposer submitted twice
    logger.warn(
      "Ignoring received gossip block",
      {
        reason: "same proposer submitted twice",
        proposerIndex: signedBlock.message.proposerIndex,
        root: toHexString(root)
      }
    );
    return ExtendedValidatorResult.ignore;
  }

  if (state.slot < blockSlot) {
    processSlots(epochCtx, state, blockSlot);
  }

  if (!isExpectedBlockProposer(epochCtx, signedBlock.message)) {
    logger.warn(
      "Rejecting received gossip block",
      {reason: "wrong block proposer", root: toHexString(root)}
    );
    return ExtendedValidatorResult.reject;
  }

  if (!verifyBlockSignatureFast(epochCtx, state, signedBlock)) {
    logger.warn(
      "Rejecting received gossip block",
      {reason: "invalid signature", root: toHexString(root)}
    );
    return ExtendedValidatorResult.reject;
  }
  logger.debug("Received gossip block passed validation", {root: toHexString(root)});
  return ExtendedValidatorResult.accept;
}

export function isFinalizedBlockSlot(config: IBeaconConfig, blockSlot: Slot, finalizedEpoch: Epoch): boolean {
  return blockSlot <= computeStartSlotAtEpoch(config, finalizedEpoch);
}

export function getBlockTimeDisparity(config: IBeaconConfig, genesisTime: Number64, blockSlot: Slot): number {
  const blockTime = (genesisTime + blockSlot * config.params.SECONDS_PER_SLOT) * 1000;
  const currentTime = Date.now();
  return blockTime - currentTime;
}

export function isExpectedBlockProposer(epochCtx: EpochContext, block: BeaconBlock): boolean {
  const expectedProposer = epochCtx.getBeaconProposer(block.slot);
  return expectedProposer === block.proposerIndex;
}
