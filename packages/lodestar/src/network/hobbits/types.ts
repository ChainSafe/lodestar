/**
 * @module network/hobbits
 */

import {bytes, number64, uint16, uint8} from "../../types";

export enum Events {
  Status = "STATUS",
  Hello = "HELLO", 
  NewData = "NEW_DATA"
}

export interface DecodedMessage {
  version: number;
  protocol: number;
  requestHeader: WireRequestHeader;
  requestBody: WireRequestBody;
}


export interface WireRequestHeader {
  methodId: uint16;
  id: number;
}

export interface WireRequestBody {
  body: bytes;
}