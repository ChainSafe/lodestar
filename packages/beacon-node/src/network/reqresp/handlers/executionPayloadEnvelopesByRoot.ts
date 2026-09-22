import {PeerId} from "@libp2p/interface";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {EnvelopeReconstructionError} from "../../../chain/errors/index.js";
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

  // Resolve slots first so archived blinded envelopes are rebuilt in one EL batch, not one call per root
  const requests: {blockSlot: Slot; blockRootHex: RootHex}[] = [];
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
    requests.push({blockSlot: slot, blockRootHex: rootHex});
  }

  let envelopesBytes: (Uint8Array | null)[];
  try {
    // by-root allows omission, so a mismatched envelope is left out rather than failing the response
    envelopesBytes = await chain.getSerializedExecutionPayloadEnvelopes(requests, "omit");
  } catch (e) {
    if (e instanceof EnvelopeReconstructionError) {
      throw new ResponseError(
        RespStatus.RESOURCE_UNAVAILABLE,
        `Failed to reconstruct archived envelopes: ${e.message}`
      );
    }
    throw e;
  }

  for (let i = 0; i < requests.length; i++) {
    const {blockSlot, blockRootHex} = requests[i];
    const envelopeBytes = envelopesBytes[i];
    if (envelopeBytes) {
      yield {
        data: envelopeBytes,
        boundary: chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(blockSlot)),
      };
    } else {
      chain.logger.debug("Cannot serve ExecutionPayloadEnvelopesByRoot: envelope not found", {
        slot: blockSlot,
        root: blockRootHex,
        peer: prettyPrintPeerId(peerId),
        client: peerClient,
      });
    }
  }
}
