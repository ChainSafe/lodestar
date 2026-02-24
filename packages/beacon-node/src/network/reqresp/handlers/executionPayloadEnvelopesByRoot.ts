import {ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {ExecutionPayloadEnvelopesByRootRequest} from "../../../util/types.js";

export async function* onExecutionPayloadEnvelopesByRoot(
  requestBody: ExecutionPayloadEnvelopesByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  const finalizedSlot = chain.forkChoice.getFinalizedBlock().slot;

  for (const blockRoot of requestBody) {
    const blockRootHex = toRootHex(blockRoot);
    const block = chain.forkChoice.getBlockHexDefaultStatus(blockRootHex);

    if (!block) {
      continue;
    }

    // SPEC: Clients MUST support requesting payload envelopes since the latest finalized epoch.
    if (block.slot <= finalizedSlot) {
      const envelope = await db.executionPayloadEnvelopeArchive.get(block.slot);
      if (envelope && toRootHex(envelope.message.beaconBlockRoot) === blockRootHex) {
        const data = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
        yield {
          data,
          boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
        };
      }
      continue;
    }

    const envelope = await db.executionPayloadEnvelope.get(blockRoot);
    if (envelope) {
      const data = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
      yield {
        data,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.slot)),
      };
    }
  }
}
