import {ssz} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {Api} from "../../../../src/beacon/routes/lightclient.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = Uint8Array.from(Buffer.alloc(32, 1));

const lightClientUpdate = ssz.altair.LightClientUpdate.defaultValue();
const syncAggregate = ssz.altair.SyncAggregate.defaultValue();
const header = ssz.altair.LightClientHeader.defaultValue();
const signatureSlot = ssz.Slot.defaultValue();

export const testData: GenericServerTestCases<Api> = {
  getUpdates: {
    args: [1, 2],
    res: [{version: ForkName.bellatrix, data: lightClientUpdate}],
  },
  getOptimisticUpdate: {
    args: [],
    res: {version: ForkName.bellatrix, data: {syncAggregate, attestedHeader: header, signatureSlot}},
  },
  getFinalityUpdate: {
    args: [],
    res: {
      version: ForkName.bellatrix,
      data: {
        syncAggregate,
        attestedHeader: header,
        finalizedHeader: lightClientUpdate.finalizedHeader,
        finalityBranch: lightClientUpdate.finalityBranch,
        signatureSlot: lightClientUpdate.attestedHeader.beacon.slot + 1,
      },
    },
  },
  getBootstrap: {
    args: [toHexString(root)],
    res: {
      version: ForkName.bellatrix,
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
