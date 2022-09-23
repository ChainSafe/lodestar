import {ForkName} from "@lodestar/params";
import {ssz, Slot, allForks} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {Api, BlockHeaderResponse, ValidatorResponse} from "../../../../src/beacon/routes/beacon/index.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = Buffer.alloc(32, 1);
const balance = 32e9;
const pubkeyHex = toHexString(Buffer.alloc(48, 1));

const blockHeaderResponse: BlockHeaderResponse = {
  root,
  canonical: true,
  header: ssz.phase0.SignedBeaconBlockHeader.defaultValue(),
};

const validatorResponse: ValidatorResponse = {
  index: 1,
  balance,
  status: "active_ongoing",
  validator: ssz.phase0.Validator.defaultValue(),
};

export const testData: GenericServerTestCases<Api> = {
  // block

  getBlock: {
    args: ["head"],
    res: {data: ssz.phase0.SignedBeaconBlock.defaultValue()},
  },
  getBlockV2: {
    args: ["head"],
    res: {executionOptimistic: true, data: ssz.bellatrix.SignedBeaconBlock.defaultValue(), version: ForkName.bellatrix},
  },
  getBlockAttestations: {
    args: ["head"],
    res: {executionOptimistic: true, data: [ssz.phase0.Attestation.defaultValue()]},
  },
  getBlockHeader: {
    args: ["head"],
    res: {executionOptimistic: true, data: blockHeaderResponse},
  },
  getBlockHeaders: {
    args: [{slot: 1, parentRoot: toHexString(root)}],
    res: {executionOptimistic: true, data: [blockHeaderResponse]},
  },
  getBlockRoot: {
    args: ["head"],
    res: {executionOptimistic: true, data: {root}},
  },
  publishBlock: {
    args: [ssz.phase0.SignedBeaconBlock.defaultValue()],
    res: undefined,
  },
  publishBlindedBlock: {
    args: [getDefaultBlindedBlock(64)],
    res: undefined,
  },

  // pool

  getPoolAttestations: {
    args: [{slot: 1, committeeIndex: 2}],
    res: {data: [ssz.phase0.Attestation.defaultValue()]},
  },
  getPoolAttesterSlashings: {
    args: [],
    res: {data: [ssz.phase0.AttesterSlashing.defaultValue()]},
  },
  getPoolProposerSlashings: {
    args: [],
    res: {data: [ssz.phase0.ProposerSlashing.defaultValue()]},
  },
  getPoolVoluntaryExits: {
    args: [],
    res: {data: [ssz.phase0.SignedVoluntaryExit.defaultValue()]},
  },
  submitPoolAttestations: {
    args: [[ssz.phase0.Attestation.defaultValue()]],
    res: undefined,
  },
  submitPoolAttesterSlashings: {
    args: [ssz.phase0.AttesterSlashing.defaultValue()],
    res: undefined,
  },
  submitPoolProposerSlashings: {
    args: [ssz.phase0.ProposerSlashing.defaultValue()],
    res: undefined,
  },
  submitPoolVoluntaryExit: {
    args: [ssz.phase0.SignedVoluntaryExit.defaultValue()],
    res: undefined,
  },
  submitPoolSyncCommitteeSignatures: {
    args: [[ssz.altair.SyncCommitteeMessage.defaultValue()]],
    res: undefined,
  },

  // state

  getStateRoot: {
    args: ["head"],
    res: {executionOptimistic: true, data: {root}},
  },
  getStateFork: {
    args: ["head"],
    res: {executionOptimistic: true, data: ssz.phase0.Fork.defaultValue()},
  },
  getStateFinalityCheckpoints: {
    args: ["head"],
    res: {
      executionOptimistic: true,
      data: {
        previousJustified: ssz.phase0.Checkpoint.defaultValue(),
        currentJustified: ssz.phase0.Checkpoint.defaultValue(),
        finalized: ssz.phase0.Checkpoint.defaultValue(),
      },
    },
  },
  getStateValidators: {
    args: ["head", {id: [pubkeyHex, "1300"], status: ["active_ongoing"]}],
    res: {executionOptimistic: true, data: [validatorResponse]},
  },
  getStateValidator: {
    args: ["head", pubkeyHex],
    res: {executionOptimistic: true, data: validatorResponse},
  },
  getStateValidatorBalances: {
    args: ["head", ["1300"]],
    res: {executionOptimistic: true, data: [{index: 1300, balance}]},
  },
  getEpochCommittees: {
    args: ["head", {index: 1, slot: 2, epoch: 3}],
    res: {executionOptimistic: true, data: [{index: 1, slot: 2, validators: [1300]}]},
  },
  getEpochSyncCommittees: {
    args: ["head", 1],
    res: {executionOptimistic: true, data: {validators: [1300], validatorAggregates: [[1300]]}},
  },

  // -

  getGenesis: {
    args: [],
    res: {data: ssz.phase0.Genesis.defaultValue()},
  },
};

function getDefaultBlindedBlock(slot: Slot): allForks.SignedBlindedBeaconBlock {
  const block = ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue();
  block.message.slot = slot;
  return block;
}
