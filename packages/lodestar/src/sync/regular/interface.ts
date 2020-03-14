import {IService} from "../../node";
import {ISyncModules} from "../index";
import {CommitteeIndex, Slot} from "@chainsafe/lodestar-types";

export interface IRegularSync extends IService {
  collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): void;
}

export type IRegularSyncModules =
    Pick<ISyncModules, "config"|"db"|"chain"|"opPool"|"network"|"logger"|"reps"> & {peers: PeerInfo[]};