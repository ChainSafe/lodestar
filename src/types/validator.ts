import {BeaconState, bytes48} from "../types";
import {Shard, ValidatorIndex} from "./index";
import {Slot} from "./custom";
import {AttestationData} from "./attestation";
import {bytes, bytes96} from "./primitive";
import {SimpleContainerType} from "@chainsafe/ssz";

export interface ValidatorCtx {
  publicKey: bytes48[];
  privateKey: bytes48[];
  rpcUrl: string;
}
export const ValidatorCtx: SimpleContainerType = {
  name: "ValidatorCtx",
  fields: [
    ["publicKey", [bytes48]],
    ["privateKey", [bytes48]],
    ["rpcUrl", "string"],
  ],
};

export interface GenesisInfo {
  startTime: number;
}
export const GenesisInfo: SimpleContainerType = {
  name: "GenesisInfo",
  fields: [
    ["startTime", "number"]
  ]
};

export interface CommitteeAssignment {
  validators: ValidatorIndex[];
  shard: Shard;
  slot: Slot;
}
export const CommitteeAssignment: SimpleContainerType = {
  name: "CommitteeAssignment",
  fields: [
    ["validators", [ValidatorIndex]],
    ["shard", Shard],
    ["slot", Slot]
  ]
};
