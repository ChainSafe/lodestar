import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {
  BlockHeaderResponse,
  BroadcastValidation,
  Endpoints,
  ValidatorResponse,
} from "../../../../src/beacon/routes/beacon/index.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = new Uint8Array(32).fill(1);
const randao = new Uint8Array(32).fill(1);
const balance = 32e9;
const reward = 32e9;
const pubkeyHex = toHex(Buffer.alloc(48, 1));
const versionedHash = ssz.deneb.VersionedHash.defaultValue();

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

export const testData: GenericServerTestCases<Endpoints> = {
  // block

  getBlockV2: {
    args: {blockId: "head"},
    res: {
      data: ssz.electra.SignedBeaconBlock.defaultValue(),
      meta: {executionOptimistic: true, finalized: false, version: ForkName.electra},
    },
  },
  getBlindedBlock: {
    args: {blockId: "head"},
    res: {
      data: ssz.electra.SignedBlindedBeaconBlock.defaultValue(),
      meta: {executionOptimistic: true, finalized: false, version: ForkName.electra},
    },
  },
  getBlockAttestations: {
    args: {blockId: "head"},
    res: {data: [ssz.phase0.Attestation.defaultValue()], meta: {executionOptimistic: true, finalized: false}},
  },
  getBlockAttestationsV2: {
    args: {blockId: "head"},
    res: {
      data: [ssz.electra.Attestation.defaultValue()],
      meta: {executionOptimistic: true, finalized: false, version: ForkName.electra},
    },
  },
  getBlockHeader: {
    args: {blockId: "head"},
    res: {data: blockHeaderResponse, meta: {executionOptimistic: true, finalized: false}},
  },
  getBlockHeaders: {
    args: {slot: 1, parentRoot: toHex(root)},
    res: {data: [blockHeaderResponse], meta: {executionOptimistic: true, finalized: false}},
  },
  getBlockRoot: {
    args: {blockId: "head"},
    res: {data: {root}, meta: {executionOptimistic: true, finalized: false}},
  },
  publishBlock: {
    args: {signedBlockContents: ssz.electra.SignedBlockContents.defaultValue()},
    res: undefined,
  },
  publishBlockV2: {
    args: {
      signedBlockContents: ssz.electra.SignedBlockContents.defaultValue(),
      broadcastValidation: BroadcastValidation.consensus,
    },
    res: undefined,
  },
  publishBlindedBlock: {
    args: {signedBlindedBlock: ssz.electra.SignedBlindedBeaconBlock.defaultValue()},
    res: undefined,
  },
  publishBlindedBlockV2: {
    args: {
      signedBlindedBlock: ssz.electra.SignedBlindedBeaconBlock.defaultValue(),
      broadcastValidation: BroadcastValidation.consensus,
    },
    res: undefined,
  },
  getBlobSidecars: {
    args: {blockId: "head", indices: [0]},
    res: {
      data: [ssz.deneb.BlobSidecar.defaultValue()],
      meta: {executionOptimistic: true, finalized: false, version: ForkName.electra},
    },
  },
  getBlobs: {
    args: {blockId: "head", versionedHashes: [toHex(versionedHash)]},
    res: {
      data: [ssz.deneb.Blob.defaultValue()],
      meta: {executionOptimistic: true, finalized: false},
    },
  },

  // pool

  getPoolAttestations: {
    args: {slot: 1, committeeIndex: 2},
    res: {data: [ssz.phase0.Attestation.defaultValue()]},
  },
  getPoolAttestationsV2: {
    args: {slot: 1, committeeIndex: 2},
    res: {data: [ssz.electra.Attestation.defaultValue()], meta: {version: ForkName.electra}},
  },
  getPoolAttesterSlashings: {
    args: undefined,
    res: {data: [ssz.phase0.AttesterSlashing.defaultValue()]},
  },
  getPoolAttesterSlashingsV2: {
    args: undefined,
    res: {data: [ssz.electra.AttesterSlashing.defaultValue()], meta: {version: ForkName.electra}},
  },
  getPoolProposerSlashings: {
    args: undefined,
    res: {data: [ssz.phase0.ProposerSlashing.defaultValue()]},
  },
  getPoolVoluntaryExits: {
    args: undefined,
    res: {data: [ssz.phase0.SignedVoluntaryExit.defaultValue()]},
  },
  getPoolBLSToExecutionChanges: {
    args: undefined,
    res: {data: [ssz.capella.SignedBLSToExecutionChange.defaultValue()]},
  },
  submitPoolAttestations: {
    args: {signedAttestations: [ssz.phase0.Attestation.defaultValue()]},
    res: undefined,
  },
  submitPoolAttestationsV2: {
    args: {signedAttestations: [ssz.electra.SingleAttestation.defaultValue()]},
    res: undefined,
  },
  submitPoolAttesterSlashings: {
    args: {attesterSlashing: ssz.phase0.AttesterSlashing.defaultValue()},
    res: undefined,
  },
  submitPoolAttesterSlashingsV2: {
    args: {attesterSlashing: ssz.electra.AttesterSlashing.defaultValue()},
    res: undefined,
  },
  submitPoolProposerSlashings: {
    args: {proposerSlashing: ssz.phase0.ProposerSlashing.defaultValue()},
    res: undefined,
  },
  submitPoolVoluntaryExit: {
    args: {signedVoluntaryExit: ssz.phase0.SignedVoluntaryExit.defaultValue()},
    res: undefined,
  },
  submitPoolBLSToExecutionChange: {
    args: {blsToExecutionChanges: [ssz.capella.SignedBLSToExecutionChange.defaultValue()]},
    res: undefined,
  },
  submitPoolSyncCommitteeSignatures: {
    args: {signatures: [ssz.altair.SyncCommitteeMessage.defaultValue()]},
    res: undefined,
  },

  // state

  getStateRoot: {
    args: {stateId: "head"},
    res: {data: {root}, meta: {executionOptimistic: true, finalized: false}},
  },
  getStateFork: {
    args: {stateId: "head"},
    res: {data: ssz.phase0.Fork.defaultValue(), meta: {executionOptimistic: true, finalized: false}},
  },
  getStateRandao: {
    args: {stateId: "head", epoch: 1},
    res: {data: {randao}, meta: {executionOptimistic: true, finalized: false}},
  },
  getStateFinalityCheckpoints: {
    args: {stateId: "head"},
    res: {
      data: {
        previousJustified: ssz.phase0.Checkpoint.defaultValue(),
        currentJustified: ssz.phase0.Checkpoint.defaultValue(),
        finalized: ssz.phase0.Checkpoint.defaultValue(),
      },
      meta: {executionOptimistic: true, finalized: false},
    },
  },
  getStateValidators: {
    args: {stateId: "head", validatorIds: [pubkeyHex, "1300"], statuses: ["active_ongoing"]},
    res: {data: [validatorResponse], meta: {executionOptimistic: true, finalized: false}},
  },
  postStateValidators: {
    args: {stateId: "head", validatorIds: [pubkeyHex, 1300], statuses: ["active_ongoing"]},
    res: {data: [validatorResponse], meta: {executionOptimistic: true, finalized: false}},
  },
  postStateValidatorIdentities: {
    args: {stateId: "head", validatorIds: [1300]},
    res: {
      data: [{index: 1300, pubkey: ssz.BLSPubkey.defaultValue(), activationEpoch: 1}],
      meta: {executionOptimistic: true, finalized: false},
    },
  },
  getStateValidator: {
    args: {stateId: "head", validatorId: pubkeyHex},
    res: {data: validatorResponse, meta: {executionOptimistic: true, finalized: false}},
  },
  getStateValidatorBalances: {
    args: {stateId: "head", validatorIds: ["1300"]},
    res: {data: [{index: 1300, balance}], meta: {executionOptimistic: true, finalized: false}},
  },
  postStateValidatorBalances: {
    args: {stateId: "head", validatorIds: [1300]},
    res: {data: [{index: 1300, balance}], meta: {executionOptimistic: true, finalized: false}},
  },
  getEpochCommittees: {
    args: {stateId: "head", index: 1, slot: 2, epoch: 3},
    res: {data: [{index: 1, slot: 2, validators: [1300]}], meta: {executionOptimistic: true, finalized: false}},
  },
  getEpochSyncCommittees: {
    args: {stateId: "head", epoch: 1},
    res: {
      data: {validators: [1300], validatorAggregates: [[1300]]},
      meta: {executionOptimistic: true, finalized: false},
    },
  },
  getPendingDeposits: {
    args: {stateId: "head"},
    res: {
      data: [ssz.electra.PendingDeposit.defaultValue()],
      meta: {executionOptimistic: true, finalized: false, version: ForkName.electra},
    },
  },
  getPendingPartialWithdrawals: {
    args: {stateId: "head"},
    res: {
      data: [ssz.electra.PendingPartialWithdrawal.defaultValue()],
      meta: {executionOptimistic: true, finalized: false, version: ForkName.electra},
    },
  },
  getPendingConsolidations: {
    args: {stateId: "head"},
    res: {
      data: [ssz.electra.PendingConsolidation.defaultValue()],
      meta: {executionOptimistic: true, finalized: false, version: ForkName.electra},
    },
  },
  getProposerLookahead: {
    args: {stateId: "head"},
    res: {
      data: ssz.fulu.ProposerLookahead.defaultValue(),
      meta: {executionOptimistic: true, finalized: false, version: ForkName.fulu},
    },
  },

  // rewards

  getBlockRewards: {
    args: {blockId: "head"},
    res: {
      data: {
        proposerIndex: 0,
        total: 15,
        attestations: 8,
        syncAggregate: 4,
        proposerSlashings: 2,
        attesterSlashings: 1,
      },
      meta: {executionOptimistic: true, finalized: false},
    },
  },
  getAttestationsRewards: {
    args: {epoch: 10, validatorIds: [1300]},
    res: {
      data: {
        idealRewards: [
          {
            head: 0,
            target: 10,
            source: 20,
            inclusionDelay: 30,
            inactivity: 40,
            effectiveBalance: 50,
          },
        ],
        totalRewards: [
          {
            head: 0,
            target: 10,
            source: 20,
            inclusionDelay: 30,
            inactivity: 40,
            validatorIndex: 50,
          },
        ],
      },
      meta: {executionOptimistic: true, finalized: false},
    },
  },
  getSyncCommitteeRewards: {
    args: {blockId: "head", validatorIds: [1300]},
    res: {data: [{validatorIndex: 1300, reward}], meta: {executionOptimistic: true, finalized: false}},
  },

  // -

  getGenesis: {
    args: undefined,
    res: {data: ssz.phase0.Genesis.defaultValue()},
  },
};
