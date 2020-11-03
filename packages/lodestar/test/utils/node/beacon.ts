import deepmerge from "deepmerge";
import tmp from "tmp";
import {createEnr} from "@chainsafe/lodestar-cli/src/config";
import {params as minimalParams} from "@chainsafe/lodestar-params/lib/presets/minimal";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {ILogger} from "@chainsafe/lodestar-utils";
import {BeaconNode} from "../../../src/node";
import {createNodeJsLibp2p} from "../../../src/network/nodejs";
import {createPeerId} from "../../../src/network";
import {initDevChain} from "../../../src/node/utils/state";
import {IBeaconNodeOptions} from "../../../src/node/options";
import {silentLogger} from "../logger";

type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? RecursivePartial<U>[]
    : T[P] extends object
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
  const node = new BeaconNode(
    deepmerge(
      {
        db: {name: tmpDir.name},
        sync: {minPeers: 1},
        eth1: {enabled: false},
      } as Partial<IBeaconNodeOptions>,
      options
    ) as Partial<IBeaconNodeOptions>,
    {
      config,
      logger: logger || silentLogger,
      libp2p: await createNodeJsLibp2p(
        peerId,
        {
          discv5: {
            // @ts-ignore
            enabled: false,
            enr: await createEnr(peerId),
            bindAddr: "/ip4/127.0.0.1/udp/0",
            bootEnrs: [],
          },
          localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
          minPeers: 25,
          maxPeers: 25,
        },
        null,
        true
      ),
    }
  );
  await initDevChain(node, validatorCount, genesisTime);
  return node;
}
