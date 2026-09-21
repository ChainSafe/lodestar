import {readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {deserialize, serialize} from "node:v8";
import {test} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {NetworkEvent, NetworkEventData} from "../../src/network/events.js";
import {nativeNetworkFixture} from "./nativeNetwork.js";
import type {PeerCommand, PeerConfiguration} from "./nativeNetworkProcess.js";

const peerDirectory = process.env.LODESTAR_NATIVE_PEER_DIRECTORY;
test.skipIf(!peerDirectory)(
  "serves one native peer process",
  async () => {
    if (!peerDirectory) throw new Error("Missing peer directory");
    const directory = peerDirectory;
    const config = deserialize(await readFile(join(directory, "config"))) as PeerConfiguration;
    const node = await nativeNetworkFixture(
      createBeaconConfig(config.chain, config.root),
      config.backend,
      config.native,
      config.addresses
    );
    const results: NetworkEventData[NetworkEvent.gossipMessageValidationResult][] = [];
    node.network.events.on(NetworkEvent.gossipMessageValidationResult, (result) => {
      if (results.length >= 128) throw new Error("Native peer event capacity");
      results.push(result);
    });
    let closed = false;
    const active = new Map<string, Promise<void>>();
    let failure: unknown;
    async function execute(file: string) {
      const path = join(directory, file);
      const {method, args} = deserialize(await readFile(path)) as PeerCommand;
      await rm(path);
      let response: {value?: unknown; error?: unknown};
      try {
        let value: unknown;
        switch (method) {
          case "getNetworkIdentity":
            value = await node.network.getNetworkIdentity();
            break;
          case "connectToPeer":
            value = await node.network.connectToPeer(args[0], args[1]);
            break;
          case "subscribeGossipCoreTopics":
            value = await node.network.subscribeGossipCoreTopics();
            break;
          case "sendBeaconBlocksByRoot":
            value = await node.network.sendBeaconBlocksByRoot(args[0], args[1]);
            break;
          case "publishProposerSlashing":
            value = await node.network.publishProposerSlashing(args[0]);
            break;
          case "scrapeMetrics":
            value = await node.network.scrapeMetrics();
            break;
          case "putBlock":
            value = await node.db.blockArchive.put(args[0], args[1]);
            break;
          case "hasSeenProposerSlashing":
            value = node.chain.opPool.hasSeenProposerSlashing(args[0]);
            break;
          case "validationResults":
            value = results.slice();
            break;
          case "close":
            await node.close();
            closed = true;
            break;
          default:
            throw new Error("Unknown peer command");
        }
        response = {value};
      } catch (error) {
        response = {error};
      }
      const output = join(directory, file.replace("request-", "response-"));
      await writeFile(`${output}.tmp`, serialize(response));
      await rename(`${output}.tmp`, output);
    }
    try {
      await writeFile(join(directory, "ready.tmp"), serialize(true));
      await rename(join(directory, "ready.tmp"), join(directory, "ready"));
      for (let i = 0; i < 6000 && !closed; i++) {
        if (failure) throw failure;
        const files = (await readdir(directory)).filter((file) => /^request-\d+$/.test(file) && !active.has(file));
        if (files.length + active.size > 32) throw new Error("Native peer command capacity");
        for (const file of files) {
          const pending = execute(file);
          active.set(file, pending);
          void pending
            .catch((error: unknown) => {
              failure = error;
            })
            .finally(() => active.delete(file));
        }
        await delay(20);
      }
      if (!closed) throw new Error("Native peer lifetime exceeded");
      await Promise.all(active.values());
      if (failure) throw failure;
    } finally {
      await node.close();
    }
  },
  150000
);
