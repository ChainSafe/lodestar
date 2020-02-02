/**
 * @module sync
 */

import {RequestBody} from "@chainsafe/eth2.0-types";

import {Method, RequestId} from "../../constants";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ISyncOptions {
}

/**
 * The ISyncReqResp module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export interface ISyncReqResp {
  start: () => Promise<void>;
  stop: () => Promise<void>;

  onRequest: (peerId: PeerId, method: Method, id: RequestId, body: RequestBody) => Promise<void>;
}
