/* eslint-disable @typescript-eslint/no-namespace */
import {AttestationData as Phase0AttestationData, PendingAttestation as Phase0PendingAttestation} from "../../misc";
import {Root} from "../..";
import {Shard} from ".";

export interface AttestationData extends Phase0AttestationData {
  // Shard vote
  shard: Shard;
  // Current-slot shard block root
  shardHeadRoot: Root;
  // Shard transition root
  shardTransitionRoot: Root;
}

export {Attestation, AttesterSlashing} from "../../operations";

export interface PendingAttestation extends Phase0PendingAttestation {
  crosslinkSuccess: boolean;
}

export {IndexedAttestation} from "../../misc";
