import {expect} from "chai";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {sleep} from "@lodestar/utils";
import {ssz} from "@lodestar/types";
import {Network} from "../../../src/network/index.js";
import {GossipType, GossipHandlerParamGeneric} from "../../../src/network/gossip/index.js";
import {connect, onPeerConnect, getNetworkForTest} from "../../utils/network.js";

await runTests({useWorker: false});
await runTests({useWorker: true});

async function runTests({useWorker}: {useWorker: boolean}): Promise<void> {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 1,
    CAPELLA_FORK_EPOCH: 1,
  });

  let onVoluntaryExit: (ve: Uint8Array) => void;
  const onVoluntaryExitPromise = new Promise<Uint8Array>((resolve) => (onVoluntaryExit = resolve));

  const gossipHandlersPartial = {
    [GossipType.voluntary_exit]: async ({gossipData}: GossipHandlerParamGeneric<GossipType.voluntary_exit>) => {
      onVoluntaryExit(gossipData.serializedData);
    },
  };
  const [netA, closeA] = await getNetworkForTest("A", config, {opts: {useWorker}, gossipHandlersPartial});
  const [netB, closeB] = await getNetworkForTest("B", config, {opts: {useWorker}, gossipHandlersPartial});

  afterEachCallbacks.push(async () => {
    await closeA();
    await closeB();
  });

  await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
  expect(netA.getConnectedPeerCount()).to.equal(1);
  expect(netB.getConnectedPeerCount()).to.equal(1);

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

  const receivedVoluntaryExit = await onVoluntaryExitPromise;
  expect(receivedVoluntaryExit).to.deep.equal(ssz.phase0.SignedVoluntaryExit.serialize(voluntaryExit));

  console.log(receivedVoluntaryExit);

  while (afterEachCallbacks.length > 0) {
    const callback = afterEachCallbacks.pop();
    if (callback) await callback();
  }
}

async function hasSomeMeshPeer(net: Network): Promise<boolean> {
  return Object.values(await net.dumpMeshPeers()).some((peers) => peers.length > 0);
}
