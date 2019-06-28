import {number64} from "../../types";

export enum Events {
  Status = "STATUS",
  Hello = "HELLO", 
  NewData = "NEW_DATA"
}

export interface DecodedMessage {
  protocol: string;
  version: number64;
  command: string;
  header: Buffer;
  payload: Buffer;
}
