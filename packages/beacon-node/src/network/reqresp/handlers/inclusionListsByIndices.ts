import {PeerId} from "@libp2p/interface";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot, computeStartSlotAtEpoch, isStatePostHeze} from "@lodestar/state-transition";
import {heze, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {prettyPrintPeerId} from "../../util.js";

/**
 * Serve inclusion lists a peer missed on gossip, e.g. while producing a payload for a slot whose
 * lists are incomplete.
 *
 * Only lists that passed gossip validation are stored, and equivocators are filtered out by the
 * store, so the spec's "SHOULD NOT respond with lists that fail gossip validation / are from
 * equivocators" holds by construction.
 */
export async function* onInclusionListsByIndices(
  requestBody: heze.InclusionListsByIndicesRequest,
  chain: IBeaconChain,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  const {slot, inclusionListCommitteeRoot, indices} = requestBody;

  const minimumRequestSlot = Math.max(
    chain.clock.currentSlot - chain.config.MIN_SLOTS_FOR_INCLUSION_LISTS_REQUESTS,
    computeStartSlotAtEpoch(chain.config.HEZE_FORK_EPOCH)
  );
  if (slot < minimumRequestSlot) {
    chain.logger.debug("Cannot serve InclusionListsByIndices: slot below minimum request slot", {
      slot,
      minimumRequestSlot,
      peer: prettyPrintPeerId(peerId),
      client: peerClient,
    });
    return;
  }

  const headState = chain.getHeadState();
  if (!isStatePostHeze(headState)) {
    return;
  }

  const signedInclusionLists = chain.inclusionListStore.getByIndices(
    headState,
    slot,
    toRootHex(inclusionListCommitteeRoot),
    indices
  );

  const boundary = chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot));
  for (const signedInclusionList of signedInclusionLists.slice(0, chain.config.MAX_REQUEST_INCLUSION_LIST)) {
    yield {
      data: ssz.heze.SignedInclusionList.serialize(signedInclusionList),
      boundary,
    };
  }
}
