//  Request/Response constants
export enum RespStatus {
  /**
   * A normal response follows, with contents matching the expected message schema and encoding specified in the request
   */
  SUCCESS = 0,
  /**
   * The contents of the request are semantically invalid, or the payload is malformed,
   * or could not be understood. The response payload adheres to the ErrorMessage schema
   */
  INVALID_REQUEST = 1,
  /**
   * The responder encountered an error while processing the request. The response payload adheres to the ErrorMessage schema
   */
  SERVER_ERROR = 2,
  /**
   * The responder does not have requested resource.  The response payload adheres to the ErrorMessage schema (described below). Note: This response code is only valid as a response to BlocksByRange
   */
  RESOURCE_UNAVAILABLE = 3,
  /**
   * Our node does not have bandwidth to serve requests due to either per-peer quota or total quota.
   */
  RATE_LIMITED = 139,
}

export type RpcResponseStatusError = Exclude<RespStatus, RespStatus.SUCCESS>;
