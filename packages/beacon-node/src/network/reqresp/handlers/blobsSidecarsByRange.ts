import {deneb} from "@lodestar/types";
import {ProtocolDescriptor, ResponseOutgoing} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {onBlocksOrBlobsSidecarsByRange} from "./beaconBlocksByRange.js";

// TODO DENEB: Unit test

export function onBlobsSidecarsByRange(
  protocol: ProtocolDescriptor,
  request: deneb.BlobsSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<ResponseOutgoing> {
  return onBlocksOrBlobsSidecarsByRange(protocol, request, chain, {
    finalized: db.blobsSidecarArchive,
    unfinalized: db.blobsSidecar,
  });
}
