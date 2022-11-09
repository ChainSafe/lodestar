import deepmerge from "deepmerge";
import tmp from "tmp";
import {PeerId} from "@libp2p/interface-peer-id";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {config as minimalConfig} from "@lodestar/config/default";
import {createIBeaconConfig, createIChainForkConfig, IChainConfig} from "@lodestar/config";
import {ILogger, RecursivePartial} from "@lodestar/utils";
import {LevelDbController} from "@lodestar/db";
import {phase0} from "@lodestar/types";
import {GENESIS_SLOT} from "@lodestar/params";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {isPlainObject} from "@lodestar/utils";
import {createKeypairFromPeerId, ENR} from "@chainsafe/discv5";
import {BeaconNode} from "../../../src/index.js";
import {createNodeJsLibp2p} from "../../../src/network/nodejs/index.js";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {initDevState, writeDeposits} from "../../../src/node/utils/state.js";
import {IBeaconNodeOptions} from "../../../src/node/options.js";
import {defaultOptions} from "../../../src/node/options.js";
import {BeaconDb} from "../../../src/db/index.js";
import {testLogger} from "../logger.js";
import {InteropStateOpts} from "../../../src/node/utils/interop/state.js";

export async function getDevBeaconNode(
  opts: {
    params: Partial<IChainConfig>;
    options?: RecursivePartial<IBeaconNodeOptions>;
    validatorCount?: number;
    logger?: ILogger;
    peerId?: PeerId;
    peerStoreDir?: string;
    anchorState?: BeaconStateAllForks;
    wsCheckpoint?: phase0.Checkpoint;
  } & InteropStateOpts
): Promise<BeaconNode> {
  const {params, validatorCount = 8, peerStoreDir} = opts;
  let {options = {}, logger, peerId} = opts;

  if (!peerId) peerId = await createSecp256k1PeerId();
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  const config = createIChainForkConfig({...minimalConfig, ...params});
  logger = logger ?? testLogger();

  const db = new BeaconDb({config, controller: new LevelDbController({name: tmpDir.name}, {})});
  await db.start();

  const libp2p = await createNodeJsLibp2p(
    peerId,
    {
      discv5: {
        enabled: false,
        enr: createEnr(peerId),
        bindAddr: options.network?.discv5?.bindAddr || "/ip4/127.0.0.1/udp/0",
        bootEnrs: [],
      },
      localMultiaddrs: options.network?.localMultiaddrs || ["/ip4/127.0.0.1/tcp/0"],
      targetPeers: defaultNetworkOptions.targetPeers,
      maxPeers: defaultNetworkOptions.maxPeers,
    },
    {disablePeerDiscovery: true, peerStoreDir}
  );

  options = deepmerge(
    // This deepmerge should NOT merge the array with the defaults but overwrite them
    defaultOptions,
    deepmerge(
      // This deepmerge should merge all the array elements of the api options with the
      // dev defaults that we wish, especially for the api options
      {
        db: {name: tmpDir.name},
        eth1: {enabled: false},
        api: {rest: {api: ["beacon", "config", "events", "node", "validator"], port: 19596}},
        metrics: {enabled: false},
        network: {discv5: null},
      } as Partial<IBeaconNodeOptions>,
      options
    ),
    {
      arrayMerge: overwriteTargetArrayIfItems,
      isMergeableObject: isPlainObject,
    }
  );

  let anchorState = opts.anchorState;
  if (!anchorState) {
    const {state, deposits} = initDevState(config, validatorCount, opts);
    anchorState = state;

    // Is it necessary to persist deposits and genesis block?
    await writeDeposits(db, deposits);
    const block = config.getForkTypes(GENESIS_SLOT).SignedBeaconBlock.defaultValue();
    block.message.stateRoot = state.hashTreeRoot();
    await db.blockArchive.add(block);
  }

  const beaconConfig = createIBeaconConfig(config, anchorState.genesisValidatorsRoot);
  return await BeaconNode.init({
    opts: options as IBeaconNodeOptions,
    config: beaconConfig,
    db,
    logger,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    processShutdownCallback: () => {},
    libp2p,
    anchorState,
    wsCheckpoint: opts.wsCheckpoint,
  });
}

function createEnr(peerId: PeerId): ENR {
  const keypair = createKeypairFromPeerId(peerId);
  return ENR.createV4(keypair.publicKey);
}

function overwriteTargetArrayIfItems(target: unknown[], source: unknown[]): unknown[] {
  if (source.length === 0) {
    return target;
  }
  return source;
}
