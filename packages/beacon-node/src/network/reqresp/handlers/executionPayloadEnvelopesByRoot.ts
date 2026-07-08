import {PeerId} from "@libp2p/interface";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {ExecutionPayloadEnvelopesByRootRequest} from "../../../util/types.js";
import {prettyPrintPeerId} from "../../util.js";

export async function* onExecutionPayloadEnvelopesByRoot(
  requestBody: ExecutionPayloadEnvelopesByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  // The gloas req/resp spec uses MIN_EPOCHS_FOR_BLOCK_REQUESTS to define the minimum range peers MUST serve.
  // Archival nodes may still serve older retained payloads to allow genesis sync.

  for (const root of requestBody) {
    const rootHex = toRootHex(root);
    const block = chain.forkChoice.getBlockHexDefaultStatus(rootHex);
    // If the block is not in fork choice, it may be finalized. Attempt to find its slot in block archive
    const slot = block ? block.slot : await db.blockArchive.getSlotByRoot(root);

    if (slot === null) {
      chain.logger.debug(
        "Cannot serve ExecutionPayloadEnvelopesByRoot: block root not in fork choice or block archive",
        {
          root: rootHex,
          peer: prettyPrintPeerId(peerId),
          client: peerClient,
        }
      );
      continue;
    }

    const envelopeBytes = await chain.getSerializedExecutionPayloadEnvelope(slot, rootHex);
    if (envelopeBytes) {
      yield {
        data: envelopeBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(slot)),
      };
    } else {
      chain.logger.debug("Cannot serve ExecutionPayloadEnvelopesByRoot: envelope not found", {
        slot,
        root: rootHex,
        peer: prettyPrintPeerId(peerId),
        client: peerClient,
      });
    }
  }
}
