import {spawn} from "node:child_process";
import {mkdtemp, readFile, rename, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";
import {deserialize, serialize} from "node:v8";
import {BeaconConfig, ChainConfig} from "@lodestar/config";
import {SignedBeaconBlock, gloas, phase0, ssz} from "@lodestar/types";
import {NativeBackendOptions} from "../../src/network/core/native/options.js";
import {INetwork} from "../../src/network/interface.js";
import {getSignedBlockTypeFromBytes} from "../../src/util/multifork.js";

export type PeerConfiguration = {
  chain: ChainConfig;
  root: Uint8Array;
  backend: "native" | "libp2p";
  native: NativeBackendOptions;
  addresses: string[];
  genesisTime: number;
};
export type PeerCommand =
  | {
      method: "getNetworkIdentity" | "subscribeGossipCoreTopics" | "scrapeMetrics" | "close";
      args: [];
    }
  | {method: "connectToPeer"; args: [string, string[]]}
  | {method: "sendBeaconBlocksByRoot"; args: [string, Uint8Array[]]}
  | {method: "publishProposerSlashing"; args: [phase0.ProposerSlashing]}
  | {method: "sendExecutionPayloadEnvelopesByRoot"; args: [string, Uint8Array[]]}
  | {method: "sendExecutionPayloadEnvelopesByRange"; args: [string, gloas.ExecutionPayloadEnvelopesByRangeRequest]}
  | {method: "putEnvelope"; args: [Uint8Array, Uint8Array]}
  | {method: "putBlock"; args: [number, Uint8Array]}
  | {method: "hasSeenProposerSlashing"; args: [number]};

export async function nativeNetworkProcess(
  config: BeaconConfig,
  genesisTime: number,
  backend: "native" | "libp2p" = "native",
  native: NativeBackendOptions = {},
  addresses = ["/ip4/127.0.0.1/udp/0/quic-v1"]
) {
  const directory = await mkdtemp(join(tmpdir(), "lodestar-network-process-"));
  const chain = Object.fromEntries(Object.entries(config).filter(([key]) => key === key.toUpperCase()));
  await writeFile(
    join(directory, "config"),
    serialize({chain, root: config.genesisValidatorsRoot, backend, native, addresses, genesisTime})
  );
  const child = spawn(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--project",
      process.env.LODESTAR_PRESET === "minimal" ? "e2e" : "e2e-mainnet",
      "network/nativePeer.test.ts",
      "--maxWorkers=1",
    ],
    {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      env: {...process.env, LODESTAR_NATIVE_CASE: "peer", LODESTAR_NATIVE_PEER_DIRECTORY: directory},
      stdio: ["ignore", "ignore", "inherit"],
    }
  );
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  let sequence = 0;
  let pending = 0;
  let closing: Promise<void> | undefined;
  const kill = () => {
    child.kill();
  };
  process.once("exit", kill);
  async function read<T>(file: string): Promise<T> {
    for (let i = 0; i < 1600; i++) {
      try {
        return deserialize(await readFile(join(directory, file))) as T;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      if (exited) throw new Error(`Native peer exited before ${file}`);
      await delay(25);
    }
    throw new Error(`Native peer deadline: ${file}`);
  }
  async function call<T>(command: PeerCommand): Promise<T> {
    if (pending >= 32) throw new Error("Native peer command capacity");
    pending++;
    const id = ++sequence;
    const name = `request-${id}`;
    try {
      await writeFile(join(directory, `${name}.tmp`), serialize(command));
      await rename(join(directory, `${name}.tmp`), join(directory, name));
      const result = await read<{value: T; error?: Error}>(`response-${id}`);
      await rm(join(directory, `response-${id}`));
      if (result.error) throw result.error;
      return result.value;
    } finally {
      pending--;
    }
  }
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      try {
        if (!exited) await call({method: "close", args: []});
      } finally {
        process.removeListener("exit", kill);
        for (let i = 0; i < 200 && !exited; i++) await delay(10);
        if (!exited) child.kill();
        await rm(directory, {recursive: true, force: true});
      }
    })();
    return closing;
  };
  try {
    await read("ready");
    return {
      close,
      network: {
        getNetworkIdentity: () =>
          call<Awaited<ReturnType<INetwork["getNetworkIdentity"]>>>({method: "getNetworkIdentity", args: []}),
        connectToPeer: (peer: string, addresses: string[]) =>
          call<void>({method: "connectToPeer", args: [peer, addresses]}),
        subscribeGossipCoreTopics: () => call<void>({method: "subscribeGossipCoreTopics", args: []}),
        sendBeaconBlocksByRoot: async (peer: string, roots: Uint8Array[]) =>
          (await call<Uint8Array[]>({method: "sendBeaconBlocksByRoot", args: [peer, roots]})).map((bytes) =>
            getSignedBlockTypeFromBytes(config, bytes).deserialize(bytes)
          ),
        sendExecutionPayloadEnvelopesByRoot: async (peer: string, roots: Uint8Array[]) =>
          (await call<Uint8Array[]>({method: "sendExecutionPayloadEnvelopesByRoot", args: [peer, roots]})).map(
            (bytes) => ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(bytes)
          ),
        sendExecutionPayloadEnvelopesByRange: async (
          peer: string,
          request: gloas.ExecutionPayloadEnvelopesByRangeRequest
        ) =>
          (await call<Uint8Array[]>({method: "sendExecutionPayloadEnvelopesByRange", args: [peer, request]})).map(
            (bytes) => ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(bytes)
          ),
        publishProposerSlashing: (slashing: phase0.ProposerSlashing) =>
          call<number>({method: "publishProposerSlashing", args: [slashing]}),
        scrapeMetrics: () => call<string>({method: "scrapeMetrics", args: []}),
      },
      db: {
        executionPayloadEnvelope: {
          put: (root: Uint8Array, envelope: gloas.SignedExecutionPayloadEnvelope) =>
            call<void>({
              method: "putEnvelope",
              args: [root, ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope)],
            }),
        },
        blockArchive: {
          put: (slot: number, block: SignedBeaconBlock) =>
            call<void>({
              method: "putBlock",
              args: [slot, config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block)],
            }),
        },
      },
      chain: {
        opPool: {
          hasSeenProposerSlashing: (index: number) => call<boolean>({method: "hasSeenProposerSlashing", args: [index]}),
        },
      },
    };
  } catch (error) {
    process.removeListener("exit", kill);
    child.kill();
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
}
