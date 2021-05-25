import {ForkName} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/minimal";
import {routes} from "../../src";
import {runGenericServerTest} from "../utils/genericServerTest";

const ZERO_HASH = Buffer.alloc(32, 0);

describe("validator", () => {
  runGenericServerTest<routes.validator.Api, routes.validator.ReqTypes>(config, routes.validator, {
    getAttesterDuties: {
      args: [1000, [1, 2, 3]],
      res: {
        data: [
          {
            pubkey: Buffer.alloc(96, 1),
            validatorIndex: 2,
            committeeIndex: 3,
            committeeLength: 4,
            committeesAtSlot: 5,
            validatorCommitteeIndex: 6,
            slot: 7,
          },
        ],
        dependentRoot: ZERO_HASH,
      },
    },
    getProposerDuties: {
      args: [1000],
      res: {data: [{slot: 1, validatorIndex: 2, pubkey: Buffer.alloc(48, 3)}], dependentRoot: ZERO_HASH},
    },
    getSyncCommitteeDuties: {
      args: [1000, [1, 2, 3]],
      res: {
        data: [{pubkey: Buffer.alloc(48, 1), validatorIndex: 2, validatorSyncCommitteeIndices: [3]}],
        dependentRoot: ZERO_HASH,
      },
    },
    produceBlock: {
      args: [32000, Buffer.alloc(96, 1), "graffiti"],
      res: {data: config.types.phase0.BeaconBlock.defaultValue(), version: ForkName.phase0},
    },
    produceAttestationData: {
      args: [2, 32000],
      res: {data: config.types.phase0.AttestationData.defaultValue()},
    },
    produceSyncCommitteeContribution: {
      args: [32000, 2, ZERO_HASH],
      res: {data: config.types.altair.SyncCommitteeContribution.defaultValue()},
    },
    getAggregatedAttestation: {
      args: [ZERO_HASH, 32000],
      res: {data: config.types.phase0.Attestation.defaultValue()},
    },
    publishAggregateAndProofs: {
      args: [[config.types.phase0.SignedAggregateAndProof.defaultValue()]],
      res: undefined,
    },
    publishContributionAndProofs: {
      args: [[config.types.altair.SignedContributionAndProof.defaultValue()]],
      res: undefined,
    },
    prepareBeaconCommitteeSubnet: {
      args: [[{validatorIndex: 1, committeeIndex: 2, committeesAtSlot: 3, slot: 4, isAggregator: true}]],
      res: undefined,
    },
    prepareSyncCommitteeSubnets: {
      args: [[{validatorIndex: 1, syncCommitteeIndices: [2], untilEpoch: 3}]],
      res: undefined,
    },
  });
});
