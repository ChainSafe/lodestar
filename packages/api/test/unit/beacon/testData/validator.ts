import {ForkName} from "@lodestar/params";
import {ssz, ProducedBlockSource} from "@lodestar/types";
import {BuilderSelection, Endpoints} from "../../../../src/beacon/routes/validator.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const ZERO_HASH = new Uint8Array(32);
const ZERO_HASH_HEX = "0x" + Buffer.from(ZERO_HASH).toString("hex");
const randaoReveal = new Uint8Array(96).fill(1);
const selectionProof = new Uint8Array(96).fill(1);
const graffiti = "a".repeat(32);
const feeRecipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const testData: GenericServerTestCases<Endpoints> = {
  getAttesterDuties: {
    args: {epoch: 1000, indices: [1, 2, 3]},
    res: {
      data: [
        {
          pubkey: new Uint8Array(48).fill(1),
          validatorIndex: 2,
          committeeIndex: 3,
          committeeLength: 4,
          committeesAtSlot: 5,
          validatorCommitteeIndex: 6,
          slot: 7,
        },
      ],
      meta: {executionOptimistic: true, dependentRoot: ZERO_HASH_HEX},
    },
  },
  getProposerDuties: {
    args: {epoch: 1000},
    res: {
      data: [{slot: 1, validatorIndex: 2, pubkey: new Uint8Array(48).fill(3)}],
      meta: {executionOptimistic: true, dependentRoot: ZERO_HASH_HEX},
    },
  },
  getSyncCommitteeDuties: {
    args: {epoch: 1000, indices: [1, 2, 3]},
    res: {
      data: [{pubkey: new Uint8Array(48).fill(1), validatorIndex: 2, validatorSyncCommitteeIndices: [3]}],
      meta: {executionOptimistic: true},
    },
  },
  produceBlock: {
    args: {slot: 32000, randaoReveal, graffiti},
    res: {data: ssz.phase0.BeaconBlock.defaultValue(), meta: {version: ForkName.phase0}},
  },
  produceBlockV2: {
    args: {
      slot: 32000,
      randaoReveal,
      graffiti,
      feeRecipient,
      builderSelection: BuilderSelection.ExecutionAlways,
      strictFeeRecipientCheck: true,
    },
    res: {
      data: ssz.altair.BeaconBlock.defaultValue(),
      meta: {
        version: ForkName.altair,
      },
    },
  },
  produceBlockV3: {
    args: {
      slot: 32000,
      randaoReveal,
      graffiti,
      skipRandaoVerification: true,
      builderBoostFactor: 0n,
      feeRecipient,
      builderSelection: BuilderSelection.ExecutionAlways,
      strictFeeRecipientCheck: true,
      blindedLocal: false,
    },
    res: {
      data: ssz.altair.BeaconBlock.defaultValue(),
      meta: {
        version: ForkName.altair,
        executionPayloadValue: ssz.Wei.defaultValue(),
        consensusBlockValue: ssz.Wei.defaultValue(),
        executionPayloadBlinded: false,
        executionPayloadSource: ProducedBlockSource.engine,
      },
    },
  },
  produceBlindedBlock: {
    args: {slot: 32000, randaoReveal, graffiti},
    res: {
      data: ssz.bellatrix.BlindedBeaconBlock.defaultValue(),
      meta: {
        version: ForkName.bellatrix,
      },
    },
  },
  produceAttestationData: {
    args: {committeeIndex: 2, slot: 32000},
    res: {data: ssz.phase0.AttestationData.defaultValue()},
  },
  produceSyncCommitteeContribution: {
    args: {slot: 32000, subcommitteeIndex: 2, beaconBlockRoot: ZERO_HASH},
    res: {data: ssz.altair.SyncCommitteeContribution.defaultValue()},
  },
  getAggregatedAttestation: {
    args: {attestationDataRoot: ZERO_HASH, slot: 32000, committeeIndex: 2},
    res: {data: ssz.phase0.Attestation.defaultValue(), meta: {version: ForkName.phase0}},
  },
  publishAggregateAndProofs: {
    args: {signedAggregateAndProofs: [ssz.phase0.SignedAggregateAndProof.defaultValue()]},
    res: undefined,
  },
  publishContributionAndProofs: {
    args: {contributionAndProofs: [ssz.altair.SignedContributionAndProof.defaultValue()]},
    res: undefined,
  },
  prepareBeaconCommitteeSubnet: {
    args: {subscriptions: [{validatorIndex: 1, committeeIndex: 2, committeesAtSlot: 3, slot: 4, isAggregator: true}]},
    res: undefined,
  },
  prepareSyncCommitteeSubnets: {
    args: {subscriptions: [{validatorIndex: 1, syncCommitteeIndices: [2], untilEpoch: 3}]},
    res: undefined,
  },
  prepareBeaconProposer: {
    args: {proposers: [{validatorIndex: 1, feeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b"}]},
    res: undefined,
  },
  submitBeaconCommitteeSelections: {
    args: {selections: []},
    res: {data: [{validatorIndex: 1, slot: 2, selectionProof}]},
  },
  submitSyncCommitteeSelections: {
    args: {selections: []},
    res: {data: [{validatorIndex: 1, slot: 2, subcommitteeIndex: 3, selectionProof}]},
  },
  getLiveness: {
    args: {epoch: 0, indices: [0]},
    res: {data: []},
  },
  registerValidator: {
    args: {registrations: [ssz.bellatrix.SignedValidatorRegistrationV1.defaultValue()]},
    res: undefined,
  },
};
