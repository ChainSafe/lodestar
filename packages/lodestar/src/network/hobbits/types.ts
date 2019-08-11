/**
 * @module network/hobbits
 */

import {bytes, uint16} from "../../types";

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

export interface HobbitsValidatedUri {
  scheme: string;
  identity: string;
  host: string;
  port: number;
}