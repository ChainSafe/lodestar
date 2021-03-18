/**
 * @module sync
 */

/**
 * The IReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export interface IReqRespHandler {
  start: () => void;
  stop: () => Promise<void>;
}
