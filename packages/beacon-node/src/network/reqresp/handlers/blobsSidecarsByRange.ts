import {deneb} from "@lodestar/types";
import {IncomingPayload, OutgoingPayloadBytes, ProtocolDescriptor} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {onBlocksOrBlobsSidecarsByRange} from "./beaconBlocksByRange.js";

// TODO DENEB: Unit test

export function onBlobsSidecarsByRange(
  protocol: ProtocolDescriptor<deneb.BlobsSidecarsByRangeRequest, deneb.BlobsSidecar>,
  request: IncomingPayload<deneb.BlobsSidecarsByRangeRequest>,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<OutgoingPayloadBytes> {
  return onBlocksOrBlobsSidecarsByRange(protocol, request, chain, {
    finalized: db.blobsSidecarArchive,
    unfinalized: db.blobsSidecar,
  });
}
