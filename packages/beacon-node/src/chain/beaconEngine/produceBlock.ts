import {isForkPostGloas} from "@lodestar/params";
import {BeaconBlock, BlindedBeaconBlock, BlindedBeaconBlockBody, Wei} from "@lodestar/types";
import {fromHex, gweiToWei, toRootHex} from "@lodestar/utils";
import {ZERO_HASH} from "../../constants/index.js";
import {CommonBlockBody} from "../interface.js";
import {computeNewStateRoot} from "../produceBlock/computeNewStateRoot.js";
import {
  AssembledBlockType,
  BlockAttributes,
  BlockType,
  ProduceResult,
  produceCommonBlockBody as assembleCommonBlockBody,
  produceBlockBody,
} from "../produceBlock/produceBlockBody.js";
import {RegenCaller} from "../regen/index.js";
import type {BeaconEngine} from "./beaconEngine.js";

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#produceCommonBlockBody.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function produceCommonBlockBody(
  this: BeaconEngine,
  blockAttributes: BlockAttributes
): Promise<CommonBlockBody> {
  const {slot, parentBlock} = blockAttributes;
  const state = await this.regen.getBlockSlotState(
    parentBlock,
    slot,
    {dontTransferCache: true},
    RegenCaller.produceBlock
  );

  // TODO: To avoid breaking changes for metric define this attribute
  const blockType = BlockType.Full;

  return assembleCommonBlockBody.call(this, blockType, state, blockAttributes);
}

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#produceBlock.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export function produceBlock(
  this: BeaconEngine,
  blockAttributes: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>}
): Promise<{
  block: BeaconBlock;
  executionPayloadValue: Wei;
  consensusBlockValue: Wei;
  shouldOverrideBuilder?: boolean;
}> {
  return this.produceBlockWrapper<BlockType.Full>(BlockType.Full, blockAttributes);
}

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#produceBlindedBlock.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export function produceBlindedBlock(
  this: BeaconEngine,
  blockAttributes: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>}
): Promise<{
  block: BlindedBeaconBlock;
  executionPayloadValue: Wei;
  consensusBlockValue: Wei;
}> {
  return this.produceBlockWrapper<BlockType.Blinded>(BlockType.Blinded, blockAttributes);
}

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#produceBlockWrapper.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function produceBlockWrapper<T extends BlockType>(
  this: BeaconEngine,
  blockType: T,
  {
    randaoReveal,
    graffiti,
    slot,
    feeRecipient,
    commonBlockBodyPromise,
    parentBlock,
    builderBid,
  }: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>}
): Promise<{
  block: AssembledBlockType<T>;
  executionPayloadValue: Wei;
  consensusBlockValue: Wei;
  shouldOverrideBuilder?: boolean;
  // [beacon-engine] deviation: return the DA artifacts to the facade.
  produceResult: ProduceResult;
}> {
  const state = await this.regen.getBlockSlotState(
    parentBlock,
    slot,
    {dontTransferCache: true},
    RegenCaller.produceBlock
  );
  const proposerIndex = state.getBeaconProposer(slot);
  const proposerPubKey = this.pubkeyCache.getOrThrow(proposerIndex).toBytes();

  const {body, produceResult, executionPayloadValue, shouldOverrideBuilder} = await produceBlockBody.call(
    this,
    blockType,
    state,
    {
      randaoReveal,
      graffiti,
      slot,
      feeRecipient,
      parentBlock,
      proposerIndex,
      proposerPubKey,
      commonBlockBodyPromise,
      builderBid,
    }
  );

  // The hashtree root computed here for debug log will get cached and hence won't introduce additional delays
  const bodyRoot =
    produceResult.type === BlockType.Full
      ? this.config.getForkTypes(slot).BeaconBlockBody.hashTreeRoot(body)
      : this.config.getPostBellatrixForkTypes(slot).BlindedBeaconBlockBody.hashTreeRoot(body as BlindedBeaconBlockBody);
  this.logger.debug("Computing block post state from the produced body", {
    slot,
    bodyRoot: toRootHex(bodyRoot),
    blockType,
  });

  const block = {
    slot,
    proposerIndex,
    parentRoot: fromHex(parentBlock.blockRoot),
    stateRoot: ZERO_HASH,
    body,
  } as AssembledBlockType<T>;

  const {newStateRoot, proposerReward} = computeNewStateRoot(this.metrics, state, block);
  block.stateRoot = newStateRoot;
  // [beacon-engine] deviation: block-root hashing for the DA cache stays in the facade.

  const fork = this.config.getForkName(slot);
  // TODO GLOAS: we should retire BlockType post-gloas, may need a new enum for self vs non-self built
  if (isForkPostGloas(fork) && produceResult.type !== BlockType.Full) {
    throw Error(`Unexpected block type=${produceResult.type} for post-gloas fork=${fork}`);
  }

  // Track the produced block for consensus broadcast validations, later validation, etc.
  // [beacon-engine] deviation: the facade populates its DA cache from the returned produceResult.

  return {
    block,
    executionPayloadValue,
    consensusBlockValue: gweiToWei(proposerReward),
    shouldOverrideBuilder,
    produceResult,
  };
}
