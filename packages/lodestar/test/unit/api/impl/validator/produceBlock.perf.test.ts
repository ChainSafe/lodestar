import {config} from "@chainsafe/lodestar-config/default";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {ApiModules, getValidatorApi} from "../../../../../src/api";
import {LocalClock} from "../../../../../src/chain/clock";
import {Eth1ForBlockProduction} from "../../../../../src/eth1";
import {IBeaconSync, SyncState} from "../../../../../src/sync";
import {generateBlockSummary, generateEmptySignedBlock} from "../../../../utils/block";
import {testLogger} from "../../../../utils/logger";
import {ApiImplTestModules, setupApiImplTestServer} from "../index.test";
import {StateRegenerator} from "../../../../../src/chain/regen";
import {generateCachedState} from "../../../../utils/state";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateDeposit} from "../../../../utils/deposit";
import {allForks, ssz} from "../../../../../../types/lib";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";

describe("produceBlock benchmark", () => {
  const logger = testLogger();
  let eth1Stub: SinonStubbedInstance<Eth1ForBlockProduction>;
  let syncStub: SinonStubbedInstance<IBeaconSync>;
  let modules: ApiModules;
  let server: ApiImplTestModules;
  const sandbox = sinon.createSandbox();
  let state: CachedBeaconState<allForks.BeaconState>;
  const currentSlot = 1;

  before(() => {
    eth1Stub = sinon.createStubInstance(Eth1ForBlockProduction);
    server = setupApiImplTestServer();
    state = generateCachedState({slot: currentSlot});
    console.log(toHexString(ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader)));
    const summary = generateBlockSummary({slot: currentSlot});
    server.forkChoiceStub.getHead.returns(summary);
    server.chainStub.clock = {currentSlot} as LocalClock;
    const regenStub = (server.chainStub.regen = sandbox.createStubInstance(StateRegenerator));
    regenStub.getBlockSlotState.resolves(state);
    server.dbStub.aggregateAndProof.getBlockAttestations.resolves([generateEmptyAttestation()]);
    eth1Stub.getEth1DataAndDeposits.resolves({eth1Data: state.eth1Data, deposits: [generateDeposit()]});
    modules = {
      chain: server.chainStub,
      config,
      db: server.dbStub,
      eth1: eth1Stub,
      logger,
      network: server.networkStub,
      sync: {...syncStub, state: SyncState.SyncingFinalized},
      metrics: null,
    };
  });

  it("run the benchmark test", async () => {
    console.log("test data", state.latestBlockHeader.slot);
    const runner = new BenchmarkRunner("produce block", {
      maxMs: 60 * 1000,
      minMs: 15 * 1000,
      runs: 64,
    });

    const api = getValidatorApi(modules);
    const signedBlock = generateEmptySignedBlock();
    await runner.run({
      id: "benchmark produceBlock",
      run: async () => {
        await api.produceBlock(currentSlot, signedBlock.message.body.randaoReveal, "i wuz here");
      },
    });
  });
});
