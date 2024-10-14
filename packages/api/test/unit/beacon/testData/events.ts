import {ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {Endpoints, EventData, EventType, blobSidecarSSE} from "../../../../src/beacon/routes/events.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const abortController = new AbortController();

export const testData: GenericServerTestCases<Endpoints> = {
  eventstream: {
    args: {topics: [EventType.head, EventType.chainReorg], signal: abortController.signal, onEvent: () => {}},
    res: undefined,
  },
};

// Example values from the spec, to make it easy to assert our types match the spec
// https://github.com/ethereum/beacon-APIs/blob/9cab46ad3c94a4a2779b42fa21f6bb1955b60b56/apis/eventstream/index.yaml#L40
export const eventTestData: EventData = {
  [EventType.head]: {
    slot: 10,
    block: "0x9a2fefd2fdb57f74993c7780ea5b9030d2897b615b89f808011ca5aebed54eaf",
    state: "0x600e852a08c1200654ddf11025f1ceacb3c2e74bdd5c630cde0838b2591b69f9",
    epochTransition: false,
    previousDutyDependentRoot: "0x5e0043f107cb57913498fbf2f99ff55e730bf1e151f02f221e977c91a90a0e91",
    currentDutyDependentRoot: "0x5e0043f107cb57913498fbf2f99ff55e730bf1e151f02f221e977c91a90a0e91",
    executionOptimistic: false,
  },
  [EventType.block]: {
    slot: 10,
    block: "0x9a2fefd2fdb57f74993c7780ea5b9030d2897b615b89f808011ca5aebed54eaf",
    executionOptimistic: false,
  },
  [EventType.attestation]: ssz.phase0.Attestation.fromJson({
    aggregation_bits: "0x01",
    signature:
      "0x1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505cc411d61252fb6cb3fa0017b679f8bb2305b26a285fa2737f175668d0dff91cc1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505",
    data: {
      slot: "1",
      index: "1",
      beacon_block_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
      source: {epoch: "1", root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2"},
      target: {epoch: "1", root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2"},
    },
  }),
  [EventType.voluntaryExit]: ssz.phase0.SignedVoluntaryExit.fromJson({
    message: {epoch: "1", validator_index: "1"},
    signature:
      "0x1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505cc411d61252fb6cb3fa0017b679f8bb2305b26a285fa2737f175668d0dff91cc1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505",
  }),
  [EventType.proposerSlashing]: ssz.phase0.ProposerSlashing.fromJson({
    signed_header_1: {
      message: {
        slot: "0",
        proposer_index: "0",
        parent_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        state_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        body_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
      signature:
        "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    },
    signed_header_2: {
      message: {
        slot: "0",
        proposer_index: "0",
        parent_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        state_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        body_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
      signature:
        "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    },
  }),
  [EventType.attesterSlashing]: ssz.phase0.AttesterSlashing.fromJson({
    attestation_1: {
      attesting_indices: ["0", "1"],
      data: {
        slot: "0",
        index: "0",
        beacon_block_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        source: {
          epoch: "0",
          root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
        target: {
          epoch: "0",
          root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
      signature:
        "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    },
    attestation_2: {
      attesting_indices: ["0", "1"],
      data: {
        slot: "0",
        index: "0",
        beacon_block_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        source: {
          epoch: "0",
          root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
        target: {
          epoch: "0",
          root: "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
      signature:
        "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    },
  }),
  [EventType.blsToExecutionChange]: ssz.capella.SignedBLSToExecutionChange.fromJson({
    message: {
      validator_index: "1",
      from_bls_pubkey:
        "0x933ad9491b62059dd065b560d256d8957a8c402cc6e8d8ee7290ae11e8f7329267a8811c397529dac52ae1342ba58c95",
      to_execution_address: "0x9Be8d619c56699667c1feDCD15f6b14D8B067F72",
    },
    signature:
      "0x1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505cc411d61252fb6cb3fa0017b679f8bb2305b26a285fa2737f175668d0dff91cc1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505",
  }),
  [EventType.finalizedCheckpoint]: {
    block: "0x9a2fefd2fdb57f74993c7780ea5b9030d2897b615b89f808011ca5aebed54eaf",
    state: "0x600e852a08c1200654ddf11025f1ceacb3c2e74bdd5c630cde0838b2591b69f9",
    epoch: 2,
    executionOptimistic: false,
  },
  [EventType.chainReorg]: {
    slot: 200,
    depth: 50,
    oldHeadBlock: "0x9a2fefd2fdb57f74993c7780ea5b9030d2897b615b89f808011ca5aebed54eaf",
    newHeadBlock: "0x76262e91970d375a19bfe8a867288d7b9cde43c8635f598d93d39d041706fc76",
    oldHeadState: "0x9a2fefd2fdb57f74993c7780ea5b9030d2897b615b89f808011ca5aebed54eaf",
    newHeadState: "0x600e852a08c1200654ddf11025f1ceacb3c2e74bdd5c630cde0838b2591b69f9",
    epoch: 2,
    executionOptimistic: false,
  },
  [EventType.contributionAndProof]: ssz.altair.SignedContributionAndProof.fromJson({
    message: {
      aggregator_index: "997",
      contribution: {
        slot: "168097",
        beacon_block_root: "0x56f1fd4262c08fa81e27621c370e187e621a67fc80fe42340b07519f84b42ea1",
        subcommittee_index: "0",
        aggregation_bits: "0xffffffffffffffffffffffffffffffff",
        signature:
          "0x85ab9018e14963026476fdf784cc674da144b3dbdb47516185438768774f077d882087b90ad642469902e782a8b43eed0cfc1b862aa9a473b54c98d860424a702297b4b648f3f30bdaae8a8b7627d10d04cb96a2cc8376af3e54a9aa0c8145e3",
      },
      selection_proof:
        "0x87c305f04bfe5db27c2b19fc23e00d7ac496ec7d3e759cbfdd1035cb8cf6caaa17a36a95a08ba78c282725e7b66a76820ca4eb333822bd399ceeb9807a0f2926c67ce67cfe06a0b0006838203b493505a8457eb79913ce1a3bcd1cc8e4ef30ed",
    },
    signature:
      "0xac118511474a94f857300b315c50585c32a713e4452e26a6bb98cdb619936370f126ed3b6bb64469259ee92e69791d9e12d324ce6fd90081680ce72f39d85d50b0ff977260a8667465e613362c6d6e6e745e1f9323ec1d6f16041c4e358839ac",
  }),
  [EventType.lightClientOptimisticUpdate]: {
    version: ForkName.altair,
    data: ssz.altair.LightClientOptimisticUpdate.fromJson({
      attested_header: {
        beacon: {
          slot: "1",
          proposer_index: "1",
          parent_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
          state_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
          body_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
        },
      },
      sync_aggregate: {
        sync_committee_bits:
          "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbfffffffffffffffffffffffbffffffffffffffffffffbffffffffffffff",
        sync_committee_signature:
          "0x1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505cc411d61252fb6cb3fa0017b679f8bb2305b26a285fa2737f175668d0dff91cc1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505",
      },
      signature_slot: "1",
    }),
  },
  [EventType.lightClientFinalityUpdate]: {
    version: ForkName.altair,
    data: ssz.altair.LightClientFinalityUpdate.fromJson({
      attested_header: {
        beacon: {
          slot: "1",
          proposer_index: "1",
          parent_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
          state_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
          body_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
        },
      },
      finalized_header: {
        beacon: {
          slot: "1",
          proposer_index: "1",
          parent_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
          state_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
          body_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
        },
      },
      finality_branch: [
        "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
        "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
        "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
        "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
        "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
        "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
      ],
      sync_aggregate: {
        sync_committee_bits:
          "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbfffffffffffffffffffffffbffffffffffffffffffffbffffffffffffff",
        sync_committee_signature:
          "0x1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505cc411d61252fb6cb3fa0017b679f8bb2305b26a285fa2737f175668d0dff91cc1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505",
      },
      signature_slot: "1",
    }),
  },
  [EventType.payloadAttributes]: {
    version: ForkName.capella,
    data: ssz.capella.SSEPayloadAttributes.fromJson({
      proposer_index: "123",
      proposal_slot: "10",
      parent_block_number: "9",
      parent_block_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
      parent_block_hash: "0x9a2fefd2fdb57f74993c7780ea5b9030d2897b615b89f808011ca5aebed54eaf",
      payload_attributes: {
        timestamp: "123456",
        prev_randao: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
        suggested_fee_recipient: "0x0000000000000000000000000000000000000000",
        withdrawals: [
          {
            index: "5",
            validator_index: "10",
            address: "0x0000000000000000000000000000000000000000",
            amount: "15640",
          },
        ],
      },
    }),
  },
  [EventType.blobSidecar]: blobSidecarSSE.fromJson({
    block_root: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
    index: "1",
    kzg_commitment:
      "0x1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505cc411d61252fb6cb3fa0017b679f8bb2305b26a285fa2737f175668d0dff91cc1b66ac1fb663c9bc59509846d6ec05345bd908eda73e670af888da41af171505",
    slot: "1",
    versioned_hash: "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2",
  }),
};
