import {ssz} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "../../../../src/beacon/routes/lightclient.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = Uint8Array.from(Buffer.alloc(32, 1));

const lightClientUpdate = ssz.altair.LightClientUpdate.defaultValue();
const syncAggregate = ssz.altair.SyncAggregate.defaultValue();
const header = ssz.phase0.BeaconBlockHeader.defaultValue();
const signatureSlot = ssz.Slot.defaultValue();

export const testData: GenericServerTestCases<Api> = {
  getUpdates: {
    args: [1, 2],
    res: {data: [lightClientUpdate]},
  },
  getOptimisticUpdate: {
    args: [],
    res: {data: {syncAggregate, attestedHeader: header, signatureSlot}},
  },
  getFinalityUpdate: {
    args: [],
    res: {
      data: {
        syncAggregate,
        attestedHeader: header,
        finalizedHeader: lightClientUpdate.finalizedHeader,
        finalityBranch: lightClientUpdate.finalityBranch,
        signatureSlot: lightClientUpdate.attestedHeader.slot + 1,
      },
    },
  },
  getBootstrap: {
    args: [toHexString(root)],
    res: {
      data: {
        header,
        currentSyncCommittee: lightClientUpdate.nextSyncCommittee,
        currentSyncCommitteeBranch: [root, root, root, root, root], // Vector(Root, 5)
      },
    },
  },
  getCommitteeRoot: {
    args: [1, 2],
    res: {data: [Buffer.alloc(32, 0), Buffer.alloc(32, 1)]},
  },
};
