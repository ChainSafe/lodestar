/**
 * @module network/hobbits
 */

import {Attestation, BeaconBlock, bytes, bytes32, uint16, uint64} from "../../types";
import {GossipTopic} from "./constants";

export enum Events {
  Status = "STATUS",
  Hello = "HELLO", 
  NewData = "NEW_DATA"
}

export interface DecodedMessage {
  version: number;
  protocol: number;
  requestHeader: WireRequestHeader;
  requestBody: Buffer;
}

export interface HobbitsValidatedUri {
  scheme: string;
  identity: string;
  host: string;
  port: number;
}

export type WireRequestHeader = RPCHeader | GossipHeader;
export type WireRequestBody = RPCBody | BeaconBlock | Attestation;

export interface RPCHeader {
  methodId: uint16;
  id: number;
}

export interface RPCBody {
  body: bytes;
}

export interface GossipHeader {
  methodId: uint16;
  topic: GossipTopic;
  timestamp: uint64;
  messageHash: bytes32;
  hash: bytes32;
}

