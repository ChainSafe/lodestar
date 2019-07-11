/**
 * @module network/hobbits
 */

import {number64, uint8} from "../../types";

export enum Events {
  Status = "STATUS",
  Hello = "HELLO", 
  NewData = "NEW_DATA"
}

export interface DecodedMessage {
  version: number;
  protocol: number;
  header: Buffer;
  payload: Buffer;
}
