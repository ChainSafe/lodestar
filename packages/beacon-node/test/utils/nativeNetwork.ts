import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {testLogger} from "@lodestar/logger/test-utils";
import {BeaconStateView, createCachedBeaconState} from "@lodestar/state-transition";
import {BeaconChain} from "../../src/chain/chain.js";
import {BeaconDb} from "../../src/db/beacon.js";
import {ExecutionEngineDisabled} from "../../src/execution/index.js";
import {ArchiveMode} from "../../src/index.js";
import {NativeBackendOptions} from "../../src/network/core/native/options.js";
import {Network} from "../../src/network/network.js";
import {defaultNetworkOptions} from "../../src/network/options.js";
import {HostServingBudget} from "../../src/network/reqresp/serving/budget.js";
import {getBoundedReqRespHandlers} from "../../src/network/reqresp/serving/handler.js";
import {resolveServingPolicy} from "../../src/network/reqresp/serving/policy.js";
import {ClockStopped} from "../mocks/clock.js";
import {generateState} from "./state.js";

export async function nativeNetworkFixture(
  config: BeaconConfig,
  backend: "native" | "libp2p" = "native",
  native: NativeBackendOptions = {},
  localMultiaddrs = ["/ip4/127.0.0.1/udp/0/quic-v1"]
) {
  const directory = await mkdtemp(join(tmpdir(), "lodestar-native-integration-"));
  const logger = testLogger(backend);
  let controller: LevelDbController | undefined;
  let chain: BeaconChain | undefined;
  let network: Network | undefined;
  const close = async (): Promise<void> => {
    try {
      await network?.close();
    } finally {
      try {
        await chain?.close();
      } finally {
        try {
          await controller?.close();
        } finally {
          await rm(directory, {recursive: true, force: true});
        }
      }
    }
  };
  try {
    controller = await LevelDbController.create({name: directory}, {logger});
    const db = new BeaconDb(config, controller);
    const privateKey = await generateKeyPair("secp256k1");
    const state = generateState({slot: 0}, config, true);
    const beaconConfig = createBeaconConfig(config, state.genesisValidatorsRoot);
    pubkeyCache.syncPubkeys(state.validators.getAllReadonlyValues());
    const cached = createCachedBeaconState(state, {config: beaconConfig, pubkeyCache}, {skipSyncPubkeys: true});
    const clock = new ClockStopped(0);
    clock.genesisTime = state.genesisTime;
    chain = new BeaconChain(
      {
        archiveStateEpochFrequency: 0,
        suggestedFeeRecipient: "",
        blsVerifyAllMainThread: true,
        disableOnBlockError: true,
        disableArchiveOnCheckpoint: true,
        disableLightClientServerOnImportBlockHead: true,
        disablePrepareNextSlot: true,
        minSameMessageSignatureSetsToBatch: 32,
        archiveMode: ArchiveMode.Frequency,
      },
      {
        privateKey,
        config: beaconConfig,
        pubkeyCache,
        db,
        dataDir: directory,
        dbName: directory,
        logger,
        processShutdownCallback: () => {},
        clock,
        metrics: null,
        validatorMonitor: null,
        anchorState: new BeaconStateView(cached),
        isAnchorStateFinalized: true,
        executionEngine: new ExecutionEngineDisabled(),
      }
    );
    const budget = HostServingBudget.forEnvironment(resolveServingPolicy(beaconConfig, db, 6, clock.currentSlot));
    network = await Network.init({
      opts: {
        ...defaultNetworkOptions,
        backend,
        native: {profile: "small", ...native},
        useWorker: backend === "native",
        tcp: false,
        localMultiaddrs,
        targetPeers: 8,
        maxPeers: 12,
        skipParamsLog: true,
      },
      config: beaconConfig,
      privateKey,
      logger,
      metrics: null,
      chain,
      db,
      getReqRespHandler: getBoundedReqRespHandlers({db, chain}, budget),
    });
    return {network, chain, db, clock, privateKey, budget, close};
  } catch (error) {
    await close();
    throw error;
  }
}
