import {toHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {Endpoints} from "../../../../src/beacon/routes/lightclient.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = new Uint8Array(32).fill(1);

const lightClientUpdate = ssz.altair.LightClientUpdate.defaultValue();
const syncAggregate = ssz.altair.SyncAggregate.defaultValue();
const header = ssz.altair.LightClientHeader.defaultValue();
const signatureSlot = ssz.Slot.defaultValue();

export const testData: GenericServerTestCases<Endpoints> = {
  getLightClientUpdatesByRange: {
    args: {startPeriod: 1, count: 2},
    res: {data: [lightClientUpdate, lightClientUpdate], meta: {versions: [ForkName.altair, ForkName.altair]}},
  },
  getLightClientOptimisticUpdate: {
    args: undefined,
    res: {data: {syncAggregate, attestedHeader: header, signatureSlot}, meta: {version: ForkName.bellatrix}},
  },
  getLightClientFinalityUpdate: {
    args: undefined,
    res: {
      data: {
        syncAggregate,
        attestedHeader: header,
        finalizedHeader: lightClientUpdate.finalizedHeader,
        finalityBranch: lightClientUpdate.finalityBranch,
        signatureSlot: lightClientUpdate.attestedHeader.beacon.slot + 1,
      },
      meta: {version: ForkName.bellatrix},
    },
  },
  getLightClientBootstrap: {
    args: {blockRoot: toHexString(root)},
    res: {
      data: {
        header,
        currentSyncCommittee: lightClientUpdate.nextSyncCommittee,
        currentSyncCommitteeBranch: [root, root, root, root, root], // Vector(Root, 5)
      },
      meta: {version: ForkName.bellatrix},
    },
  },
  getLightClientCommitteeRoot: {
    args: {startPeriod: 1, count: 2},
    res: {data: [new Uint8Array(32), new Uint8Array(32).fill(1)]},
  },
};
