/**
 * @module chain/blockAssembly
 */

import {processBlock} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconBlock, Bytes96, Root, Slot, Lightclient} from "@chainsafe/lodestar-types";
import {ZERO_HASH, EMPTY_SIGNATURE} from "../../../constants";
import {IBeaconDb} from "../../../db/api";
import {ITreeStateContext} from "../../../db/api/beacon/stateContextCache";
import {IEth1ForBlockProduction} from "../../../eth1";
import {IBeaconChain} from "../../interface";
import {assembleBody} from "./body";
import {BitVector} from "@chainsafe/ssz";

export async function assembleBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  eth1: IEth1ForBlockProduction,
  slot: Slot,
  randaoReveal: Bytes96,
  graffiti = ZERO_HASH
): Promise<BeaconBlock | Lightclient.BeaconBlock> {
  if (slot >= config.params.lightclient.LIGHTCLIENT_PATCH_FORK_SLOT) {
    return assembleLightclientBlock(config, chain, db, eth1, slot, randaoReveal, graffiti);
  }
  return assemblePhase0Block(config, chain, db, eth1, slot, randaoReveal, graffiti);
}

async function assembleLightclientBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  eth1: IEth1ForBlockProduction,
  slot: Slot,
  randaoReveal: Bytes96,
  graffiti = ZERO_HASH
): Promise<Lightclient.BeaconBlock> {
  return {
    ...(await assemblePhase0Block(config, chain, db, eth1, slot, randaoReveal, graffiti)),
    syncCommitteeBits: getSyncCommitteeBits(config),
    syncCommitteeSignature: EMPTY_SIGNATURE,
  };
}

async function assemblePhase0Block(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  eth1: IEth1ForBlockProduction,
  slot: Slot,
  randaoReveal: Bytes96,
  graffiti = ZERO_HASH
): Promise<BeaconBlock> {
  const head = chain.forkChoice.getHead();
  const stateContext = await chain.regen.getBlockSlotState(head.blockRoot, slot);

  const block: BeaconBlock = {
    slot,
    proposerIndex: stateContext.epochCtx.getBeaconProposer(slot),
    parentRoot: head.blockRoot,
    stateRoot: ZERO_HASH,
    body: await assembleBody(config, db, eth1, stateContext.state, randaoReveal, graffiti),
  };
  block.stateRoot = computeNewStateRoot(config, stateContext, block);

  return block;
}

/**
 * Instead of running fastStateTransition(), only need to process block since
 * stateContext is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
function computeNewStateRoot(config: IBeaconConfig, stateContext: ITreeStateContext, block: BeaconBlock): Root {
  const postState = {
    state: stateContext.state.clone(),
    epochCtx: stateContext.epochCtx.copy(),
  };
  processBlock(postState.epochCtx, postState.state, block, true);

  return config.types.BeaconState.hashTreeRoot(postState.state);
}

function getSyncCommitteeBits(config: IBeaconConfig): BitVector {
  return Array.from({length: config.params.lightclient.SYNC_COMMITTEE_SIZE}, () => false);
}
