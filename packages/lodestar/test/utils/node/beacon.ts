import deepmerge from "deepmerge";
import tmp from "tmp";
import {createEnr} from "@chainsafe/lodestar-cli/src/config";
import {params as minimalParams} from "@chainsafe/lodestar-params/minimal";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {ILogger} from "@chainsafe/lodestar-utils";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {BeaconNode} from "../../../src/node";
import {createNodeJsLibp2p} from "../../../src/network/nodejs";
import {createPeerId} from "../../../src/network";
import {initDevState} from "../../../src/node/utils/state";
import {IBeaconNodeOptions} from "../../../src/node/options";
import {defaultOptions} from "../../../src/node/options";
import {BeaconDb} from "../../../src/db";
import {silentLogger} from "../logger";

type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? RecursivePartial<U>[]
    : T[P] extends Record<string, unknown>
    ? RecursivePartial<T[P]>
    : T[P];
};

export async function getDevBeaconNode({
  params,
  options = {},
  validatorCount = 8,
  genesisTime,
  logger,
}: {
  params: Partial<IBeaconParams>;
  options?: RecursivePartial<IBeaconNodeOptions>;
  validatorCount?: number;
  genesisTime?: number;
  logger?: ILogger;
}): Promise<BeaconNode> {
  const peerId = await createPeerId();
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  const config = createIBeaconConfig({...minimalParams, ...params});
  logger = logger ?? silentLogger;

  const db = new BeaconDb({config, controller: new LevelDbController({name: tmpDir.name}, {logger})});
  await db.start();

  const libp2p = await createNodeJsLibp2p(
    peerId,
    {
      discv5: {
        enabled: false,
        enr: await createEnr(peerId),
        bindAddr: "/ip4/127.0.0.1/udp/0",
        bootEnrs: [],
      },
      localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
      minPeers: 25,
      maxPeers: 25,
    },
    undefined,
    true
  );

  options = deepmerge(
    defaultOptions,
    deepmerge(
      {
        db: {name: tmpDir.name},
        sync: {minPeers: 1},
        eth1: {enabled: false},
        metrics: {enabled: false},
        logger: {},
      } as Partial<IBeaconNodeOptions>,
      options
    )
  );

  const anchorState = await initDevState(config, db, validatorCount, genesisTime);
  return await BeaconNode.init({
    opts: deepmerge(
      {
        db: {name: tmpDir.name},
        sync: {minPeers: 1},
        eth1: {enabled: false},
        metrics: {enabled: false},
      } as Partial<IBeaconNodeOptions>,
      options
    ) as IBeaconNodeOptions,
    config,
    db,
    logger,
    libp2p,
    anchorState,
  });
}
