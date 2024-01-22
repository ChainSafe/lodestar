import {ForkName} from "@lodestar/params";
import {ssz, ProducedBlockSource} from "@lodestar/types";
import {Api} from "../../../../src/beacon/routes/validator.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const ZERO_HASH = new Uint8Array(32);
const ZERO_HASH_HEX = "0x" + Buffer.from(ZERO_HASH).toString("hex");
const randaoReveal = new Uint8Array(96).fill(1);
const selectionProof = new Uint8Array(96).fill(1);
const graffiti = "a".repeat(32);
const feeRecipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const testData: GenericServerTestCases<Api> = {
  getAttesterDuties: {
    args: [1000, [1, 2, 3]],
    res: {
      executionOptimistic: true,
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
      dependentRoot: ZERO_HASH_HEX,
    },
  },
  getProposerDuties: {
    args: [1000],
    res: {
      executionOptimistic: true,
      data: [{slot: 1, validatorIndex: 2, pubkey: new Uint8Array(48).fill(3)}],
      dependentRoot: ZERO_HASH_HEX,
    },
  },
  getSyncCommitteeDuties: {
    args: [1000, [1, 2, 3]],
    res: {
      executionOptimistic: true,
      data: [{pubkey: Uint8Array.from(Buffer.alloc(48, 1)), validatorIndex: 2, validatorSyncCommitteeIndices: [3]}],
    },
  },
  produceBlock: {
    args: [
      32000,
      randaoReveal,
      graffiti,
      undefined,
      {
        feeRecipient,
        builderSelection: undefined,
        strictFeeRecipientCheck: undefined,
        blindedLocal: undefined,
        builderBoostFactor: 100n,
      },
    ] as unknown as GenericServerTestCases<Api>["produceBlock"]["args"],
    res: {data: ssz.phase0.BeaconBlock.defaultValue()},
  },
  produceBlockV2: {
    args: [
      32000,
      randaoReveal,
      graffiti,
      undefined,
      {
        feeRecipient,
        builderSelection: undefined,
        strictFeeRecipientCheck: undefined,
        blindedLocal: undefined,
        builderBoostFactor: 100n,
      },
    ] as unknown as GenericServerTestCases<Api>["produceBlockV2"]["args"],
    res: {
      data: ssz.altair.BeaconBlock.defaultValue(),
      version: ForkName.altair,
      executionPayloadValue: ssz.Wei.defaultValue(),
      consensusBlockValue: ssz.Wei.defaultValue(),
    },
  },
  produceBlockV3: {
    args: [
      32000,
      randaoReveal,
      graffiti,
      true,
      {
        feeRecipient,
        builderSelection: undefined,
        strictFeeRecipientCheck: undefined,
        blindedLocal: undefined,
        builderBoostFactor: 100n,
      },
    ],
    res: {
      data: ssz.altair.BeaconBlock.defaultValue(),
      version: ForkName.altair,
      executionPayloadValue: ssz.Wei.defaultValue(),
      consensusBlockValue: ssz.Wei.defaultValue(),
      executionPayloadBlinded: false,
      executionPayloadSource: ProducedBlockSource.engine,
    },
  },
  produceBlindedBlock: {
    args: [
      32000,
      randaoReveal,
      graffiti,
      undefined,
      {
        feeRecipient,
        builderSelection: undefined,
        strictFeeRecipientCheck: undefined,
        blindedLocal: undefined,
        builderBoostFactor: 100n,
      },
    ] as unknown as GenericServerTestCases<Api>["produceBlindedBlock"]["args"],
    res: {
      data: ssz.bellatrix.BlindedBeaconBlock.defaultValue(),
      version: ForkName.bellatrix,
      executionPayloadValue: ssz.Wei.defaultValue(),
      consensusBlockValue: ssz.Wei.defaultValue(),
    },
  },
  produceAttestationData: {
    args: [2, 32000],
    res: {data: ssz.phase0.AttestationData.defaultValue()},
  },
  produceSyncCommitteeContribution: {
    args: [32000, 2, ZERO_HASH],
    res: {data: ssz.altair.SyncCommitteeContribution.defaultValue()},
  },
  getAggregatedAttestation: {
    args: [ZERO_HASH, 32000],
    res: {data: ssz.phase0.Attestation.defaultValue()},
  },
  publishAggregateAndProofs: {
    args: [[ssz.phase0.SignedAggregateAndProof.defaultValue()]],
    res: undefined,
  },
  publishContributionAndProofs: {
    args: [[ssz.altair.SignedContributionAndProof.defaultValue()]],
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
  prepareBeaconProposer: {
    args: [[{validatorIndex: "1", feeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b"}]],
    res: undefined,
  },
  submitBeaconCommitteeSelections: {
    args: [[]],
    res: {data: [{validatorIndex: 1, slot: 2, selectionProof}]},
  },
  submitSyncCommitteeSelections: {
    args: [[]],
    res: {data: [{validatorIndex: 1, slot: 2, subcommitteeIndex: 3, selectionProof}]},
  },
  getLiveness: {
    args: [0, [0]],
    res: {data: []},
  },
  registerValidator: {
    args: [[ssz.bellatrix.SignedValidatorRegistrationV1.defaultValue()]],
    res: undefined,
  },
};
