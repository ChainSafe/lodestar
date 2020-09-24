import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../../chain";
import {IBeaconDb} from "../../../db/api";
import {BeaconBlock, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {computeStartSlotAtEpoch, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {ExtendedValidatorResult} from "../constants";
import {ILogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {verifyBlockSignature} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";

export async function validateGossipBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  logger: ILogger,
  block: SignedBeaconBlock
): Promise<ExtendedValidatorResult> {
  const blockSlot = block.message.slot;
  const blockRoot = config.types.BeaconBlock.hashTreeRoot(block.message);
  logger.verbose("Started gossip block validation", {blockSlot, blockRoot: toHexString(blockRoot)});
  const finalizedCheckpoint = await chain.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(config, finalizedCheckpoint.epoch);
  // block is too old
  if (blockSlot <= finalizedSlot) {
    logger.warn("Ignoring gossip block", {
      reason: "finalized slot",
      blockSlot,
      finalizedSlot,
      blockRoot: toHexString(blockRoot),
    });
    return ExtendedValidatorResult.ignore;
  }

  //if slot is in future, wait for it's time before resuming
  //this won't fix block queue since it could resume before we synced to this slot and
  // fail with missing parent state/block
  // TODO: queue those blocks and submit to gossip handler directly when parent processed
  await chain.clock.waitForSlot(blockSlot);

  if (await db.badBlock.has(blockRoot)) {
    logger.warn("Rejecting gossip block", {reason: "bad block", blockSlot, blockRoot: toHexString(blockRoot)});
    return ExtendedValidatorResult.reject;
  }

  if (await hasProposerAlreadyProposed(chain, block.message)) {
    logger.warn("Ignoring gossip block", {
      reason: "same proposer submitted twice",
      blockSlot,
      blockRoot: toHexString(blockRoot),
    });
    return ExtendedValidatorResult.ignore;
  }

  let blockContext;
  try {
    blockContext = await chain.regen.getPreState(block.message);
  } catch (e) {
    logger.warn("Ignoring gossip block", {
      reason: "missing parent",
      blockSlot,
      blockRoot: toHexString(blockRoot),
      parent: toHexString(block.message.parentRoot),
    });
    //temporary skip rest of validation and put in block pool
    //rest of validation is performed in state transition anyways
    await chain.receiveBlock(block);
    return ExtendedValidatorResult.ignore;
  }

  if (!verifyBlockSignature(blockContext.epochCtx, blockContext.state, block)) {
    logger.warn("Rejecting gossip block", {
      reason: "invalid signature",
      blockSlot,
      blockRoot: toHexString(blockRoot),
    });
    return ExtendedValidatorResult.reject;
  }

  if (!isExpectedProposer(blockContext.epochCtx, block.message)) {
    logger.warn("Rejecting gossip block", {
      reason: "wrong proposer",
      blockSlot,
      blockRoot: toHexString(blockRoot),
    });
    return ExtendedValidatorResult.reject;
  }
  logger.info("Received valid gossip block", {blockSlot, blockRoot: toHexString(blockRoot)});
  return ExtendedValidatorResult.accept;
}

export async function hasProposerAlreadyProposed(chain: IBeaconChain, block: BeaconBlock): Promise<boolean> {
  const existingBlock = await chain.getCanonicalBlockAtSlot(block.slot);
  return existingBlock?.message.proposerIndex === block.proposerIndex;
}

export function isExpectedProposer(epochCtx: EpochContext, block: BeaconBlock): boolean {
  const supposedProposerIndex = epochCtx.getBeaconProposer(block.slot);
  return supposedProposerIndex === block.proposerIndex;
}
