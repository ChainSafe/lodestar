import {ForkName} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/default";
import {toHexString} from "@chainsafe/ssz";
import {Api, ReqTypes, BlockHeaderResponse, ValidatorResponse} from "../../src/routes/beacon";
import {getClient} from "../../src/client/beacon";
import {getRoutes} from "../../src/server/beacon";
import {runGenericServerTest} from "../utils/genericServerTest";

describe("beacon", () => {
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

  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    // block

    getBlock: {
      args: ["head"],
      res: {data: ssz.phase0.SignedBeaconBlock.defaultValue()},
    },
    getBlockV2: {
      args: ["head"],
      res: {data: ssz.altair.SignedBeaconBlock.defaultValue(), version: ForkName.altair},
    },
    getBlockAttestations: {
      args: ["head"],
      res: {data: [ssz.phase0.Attestation.defaultValue()]},
    },
    getBlockHeader: {
      args: ["head"],
      res: {data: blockHeaderResponse},
    },
    getBlockHeaders: {
      args: [{slot: 1, parentRoot: toHexString(root)}],
      res: {data: [blockHeaderResponse]},
    },
    getBlockRoot: {
      args: ["head"],
      res: {data: root},
    },
    publishBlock: {
      args: [ssz.phase0.SignedBeaconBlock.defaultValue()],
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
    submitPoolAttesterSlashing: {
      args: [ssz.phase0.AttesterSlashing.defaultValue()],
      res: undefined,
    },
    submitPoolProposerSlashing: {
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
      res: {data: root},
    },
    getStateFork: {
      args: ["head"],
      res: {data: ssz.phase0.Fork.defaultValue()},
    },
    getStateFinalityCheckpoints: {
      args: ["head"],
      res: {
        data: {
          previousJustified: ssz.phase0.Checkpoint.defaultValue(),
          currentJustified: ssz.phase0.Checkpoint.defaultValue(),
          finalized: ssz.phase0.Checkpoint.defaultValue(),
        },
      },
    },
    getStateValidators: {
      args: ["head", {indices: [pubkeyHex, "1300"], statuses: ["active_ongoing"]}],
      res: {data: [validatorResponse]},
    },
    getStateValidator: {
      args: ["head", pubkeyHex],
      res: {data: validatorResponse},
    },
    getStateValidatorBalances: {
      args: ["head", ["1300"]],
      res: {data: [{index: 1300, balance}]},
    },
    getEpochCommittees: {
      args: ["head", {index: 1, slot: 2, epoch: 3}],
      res: {data: [{index: 1, slot: 2, validators: [1300]}]},
    },
    getEpochSyncCommittees: {
      args: ["head", 1],
      res: {data: {validators: [1300], validatorAggregates: [1300]}},
    },

    // -

    getGenesis: {
      args: [],
      res: {data: ssz.phase0.Genesis.defaultValue()},
    },
  });

  // TODO: Extra tests to implement maybe

  // getBlockHeaders
  // - fetch without filters
  // - parse slot param
  // - parse parentRoot param
  // - throw validation error on invalid slot
  // - throw validation error on invalid parentRoot - not hex
  // - throw validation error on invalid parentRoot - incorrect length
  // - throw validation error on invalid parentRoot - missing 0x prefix

  // getEpochCommittees
  // - succeed without filters
  // - succeed with filters
  // - throw validation error on string slot
  // - throw validation error on negative epoch

  // getStateValidator
  // - should get by root
  // - should get by index
  // - should not found state

  // getStateValidatorsBalances
  // - success with indices filter

  // All others:
  // - Failed to parse body
  // - should not found state
});
