import {ssz} from "@lodestar/types";
import {Api, EventData, EventType} from "../../../../src/beacon/routes/events.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const abortController = new AbortController();
const root = Buffer.alloc(32, 0);

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/naming-convention */

export const testData: GenericServerTestCases<Api> = {
  eventstream: {
    args: [[EventType.head, EventType.chainReorg], abortController.signal, function onEvent() {}],
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
  [EventType.blsToExecutionChange]: ssz.capella.SignedBLSToExecutionChange.fromJson({
    message: {
      validator_index: "1",
      from_bls_pubkey:
        "0x9048a71944feba4695ef870dfb5745c934d81c5efd934c0250a12942fcc2a2dfd6b20d53314379dec7aae5ca5fe9e9c4",
      to_execution_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    syncAggregate: ssz.altair.SyncAggregate.defaultValue(),
    attestedHeader: ssz.altair.LightClientHeader.defaultValue(),
    signatureSlot: ssz.Slot.defaultValue(),
  },
  [EventType.lightClientFinalityUpdate]: {
    attestedHeader: ssz.altair.LightClientHeader.defaultValue(),
    finalizedHeader: ssz.altair.LightClientHeader.defaultValue(),
    finalityBranch: [root],
    syncAggregate: ssz.altair.SyncAggregate.defaultValue(),
    signatureSlot: ssz.Slot.defaultValue(),
  },
  [EventType.lightClientUpdate]: ssz.altair.LightClientUpdate.defaultValue(),
};
