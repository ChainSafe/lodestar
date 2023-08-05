import {toHexString} from "@chainsafe/ssz";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {Slot, phase0} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../../util/sszBytes.js";

export async function* onBeaconBlocksByRoot(
  requestBody: phase0.BeaconBlocksByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  for (const blockRoot of requestBody) {
    const root = blockRoot;
    const summary = chain.forkChoice.getBlock(root);
    let blockBytes: Uint8Array | null = null;

    // finalized block has summary in forkchoice but it stays in blockArchive db
    if (summary) {
      blockBytes = await db.block.getBinary(root);
    }

    let slot: Slot | undefined = undefined;
    if (!blockBytes) {
      const blockEntry = await db.blockArchive.getBinaryEntryByRoot(root);
      if (blockEntry) {
        slot = blockEntry.key;
        blockBytes = blockEntry.value;
      }
    }

    if (blockBytes) {
      if (slot === undefined) {
        const slotFromBytes = getSlotFromSignedBeaconBlockSerialized(blockBytes);
        if (slotFromBytes === null) {
          throw Error(`Invalid block bytes for block root ${toHexString(root)}`);
        }
        slot = slotFromBytes;
      }

      // isAfterMerge can check that timestamp is != 0
      if (
        chain.config.getForkSeq(slot) > ForkSeq.bellatrix &&
        isAfterMerge(blockBytes) &&
        isPayloadHeader(blockBytes)
      ) {
        // Retrieve payload identifier to ask JSON RPC node
        const hashOrNumber = getHashOrNumber(blockBytes);
        // eth_getBlockByNumber or eth_getBlockByHash
        // capella adds the block hash in the payload, pre-capella only block number
        const executionPayload = eth1.getBlockByNumber(hashOrNumber);
        blockBytes = payloadHeaderBytesToFull(blockBytes, executionPayload);
      }

      yield {
        data: blockBytes,
        fork: chain.config.getForkName(slot),
      };
    }
  }
}
