import tmp from "tmp";
import {PeerId} from "@libp2p/interface-peer-id";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {config as minimalConfig} from "@lodestar/config/default";
import {createIBeaconConfig, createIChainForkConfig, IChainConfig} from "@lodestar/config";
import {ILogger} from "@lodestar/utils";
import {LevelDbController} from "@lodestar/db";
import {phase0} from "@lodestar/types";
import {GENESIS_SLOT} from "@lodestar/params";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {BeaconNode} from "../../../src/index.js";
import {createNodeJsLibp2p} from "../../../src/network/nodejs/index.js";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {initDevState, writeDeposits} from "../../../src/node/utils/state.js";
import {IBeaconNodeOptions} from "../../../src/node/options.js";
import {BeaconDb} from "../../../src/db/index.js";
import {testLogger} from "../logger.js";
import {InteropStateOpts} from "../../../src/node/utils/interop/state.js";

export async function getDevBeaconNode(
  opts: {
    params: Partial<IChainConfig>;
    options?: IBeaconNodeOptions;
    validatorCount?: number;
    logger?: ILogger;
    peerId?: PeerId;
    peerStoreDir?: string;
    anchorState?: BeaconStateAllForks;
    wsCheckpoint?: phase0.Checkpoint;
  } & InteropStateOpts
): Promise<BeaconNode> {
  const {options = {}, params, validatorCount = 8, peerStoreDir} = opts;
  let {logger, peerId} = opts;

  if (!peerId) peerId = await createSecp256k1PeerId();
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  const config = createIChainForkConfig({...minimalConfig, ...params});
  logger = logger ?? testLogger();

  const db = new BeaconDb({config, controller: new LevelDbController({name: tmpDir.name}, {})});
  await db.start();

  const libp2p = await createNodeJsLibp2p(
    peerId,
    {
      discv5: false,
      listenAddress: "127.0.0.1",
      targetPeers: defaultNetworkOptions.targetPeers,
      maxPeers: defaultNetworkOptions.maxPeers,
    },
    {disablePeerDiscovery: true, peerStoreDir}
  );

  // Disable eth1 for less logging noise
  options.eth1 = {enabled: false};

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
