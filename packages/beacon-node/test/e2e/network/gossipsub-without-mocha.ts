import wtf from "wtfnode";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {sleep} from "@lodestar/utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {Network} from "../../../src/network/index.js";
import {GossipType, GossipHandlers, GossipHandlerParamGeneric} from "../../../src/network/gossip/index.js";
import {connect, onPeerConnect, getNetworkForTest} from "../../utils/network.js";

await runTests({useWorker: false});
console.log("\n\n%%%%%%%%%%%% finished non worker tests");
wtf.dump();
await sleep(2000);
console.log("\n\n\n");
wtf.dump();

await runTests({useWorker: true});
console.log("\n\n%%%%%%%%%%%% finished worker tests");
wtf.dump();
await sleep(1000);
console.log("\n\n\n");
wtf.dump();

async function runTests({useWorker}: {useWorker: boolean}): Promise<void> {
  console.log("\n\n%%%%%%%%%%%% starting tests with useWorker", useWorker);
  console.log("%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%");
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];

  // Schedule all forks at ALTAIR_FORK_EPOCH to avoid generating the pubkeys cache
  /* eslint-disable @typescript-eslint/naming-convention */
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 1,
    CAPELLA_FORK_EPOCH: 1,
  });
  computeStartSlotAtEpoch(config.ALTAIR_FORK_EPOCH);

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function mockModules(gossipHandlersPartial?: Partial<GossipHandlers>) {
    const [netA, closeA] = await getNetworkForTest("A", config, {opts: {useWorker}, gossipHandlersPartial});
    const [netB, closeB] = await getNetworkForTest("B", config, {opts: {useWorker}, gossipHandlersPartial});

    afterEachCallbacks.push(async () => {
      await closeA();
      await closeB();
    });

    return {netA, netB};
  }

  let onVoluntaryExit: (ve: Uint8Array) => void;
  const onVoluntaryExitPromise = new Promise<Uint8Array>((resolve) => (onVoluntaryExit = resolve));

  const {netA, netB} = await mockModules({
    [GossipType.voluntary_exit]: async ({gossipData}: GossipHandlerParamGeneric<GossipType.voluntary_exit>) => {
      onVoluntaryExit(gossipData.serializedData);
    },
  });

  await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
  console.log("%%%%%", netA.getConnectedPeerCount());
  console.log("%%%%%", netB.getConnectedPeerCount());

  await netA.subscribeGossipCoreTopics();
  await netB.subscribeGossipCoreTopics();

  // Wait to have a peer connected to a topic
  while (!netA.closed) {
    await sleep(500);
    if (await hasSomeMeshPeer(netA)) {
      break;
    }
  }

  const voluntaryExit = ssz.phase0.SignedVoluntaryExit.defaultValue();
  voluntaryExit.message.epoch = config.ALTAIR_FORK_EPOCH;
  await netA.publishVoluntaryExit(voluntaryExit);

  await onVoluntaryExitPromise;

  while (afterEachCallbacks.length > 0) {
    const callback = afterEachCallbacks.pop();
    if (callback) await callback();
  }
}

async function hasSomeMeshPeer(net: Network): Promise<boolean> {
  return Object.values(await net.dumpMeshPeers()).some((peers) => peers.length > 0);
}
