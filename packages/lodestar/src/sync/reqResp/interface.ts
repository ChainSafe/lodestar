/**
 * @module sync
 */

import PeerId from "peer-id";
import {ReqRespRequest} from "../../network/reqresp";

/**
 * The IReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export interface IReqRespHandler {
  start: () => Promise<void>;
  stop: () => Promise<void>;

  onRequest: (request: ReqRespRequest, peerId: PeerId, sink: Sink<unknown, unknown>) => Promise<void>;
}
