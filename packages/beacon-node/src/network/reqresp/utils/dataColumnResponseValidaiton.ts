import {LogData} from "@lodestar/logger";
import {ForkSeq, KZG_COMMITMENTS_GINDEX} from "@lodestar/params";
import {ColumnIndex, Slot} from "@lodestar/types";
import {bytesToInt, toHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/interface.js";
import {IBeaconDb} from "../../../db/interface.js";

export async function logDataColumnSidecarUnavailability(opts: {
  chain: IBeaconChain;
  db: IBeaconDb;
  index: ColumnIndex;
  slot: Slot;
  blockRoot?: Uint8Array;
  logData: Record<string, LogData>;
}): Promise<void> {
  const {chain, db, index, slot, blockRoot, logData} = opts;
  let localLogData: LogData = {...logData, slot};

  if (blockRoot) {
    localLogData = {...localLogData, blockRoot: toHex(blockRoot)};
  }

  const blockBytes = blockRoot ? await db.block.getBinary(blockRoot) : await db.blockArchive.getBinary(slot);

  if (!blockBytes) {
    chain.logger.error("Expected unfinalized block not found", localLogData);
    return;
  }

  const blobsCount =
    chain.config.getForkSeq(slot) < ForkSeq.deneb
      ? 0
      : bytesToInt(blockBytes.slice(KZG_COMMITMENTS_GINDEX, KZG_COMMITMENTS_GINDEX + 4));

  localLogData = {...localLogData, blobsCount, index};

  if (blobsCount > 0) {
    chain.logger.error("Requested dataColumnSidecar is missing.", localLogData);
  } else {
    chain.logger.debug("Requested dataColumnSidecar for empty blobs", localLogData);
  }
}
