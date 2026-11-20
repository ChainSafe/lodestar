import fs from "node:fs";
import path from "node:path";
import {BuilderOptions, MAX_ADDITIONAL_GOSSIP_IDENTITIES} from "@lodestar/builder";
import {Logger} from "@lodestar/utils";
import {YargsError} from "../../util/index.js";
import {loadBuilderKeypair} from "./loadKeypair.js";

type Entry = {keystore: string; keystorePassword: string; builderPubkey?: string; deadlineBps: number};

export function parseGossipIdentities(value: unknown): Entry[] {
  if (!Array.isArray(value) || value.length > MAX_ADDITIONAL_GOSSIP_IDENTITIES)
    throw new YargsError(
      `--bidding.gossipIdentitiesFile must contain at most ${MAX_ADDITIONAL_GOSSIP_IDENTITIES} identities`
    );
  return value.map((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null) throw new YargsError(`Invalid gossip identity at index ${index}`);
    const item = entry as Record<string, unknown>;
    if (
      typeof item.keystore !== "string" ||
      !item.keystore ||
      typeof item.keystorePassword !== "string" ||
      !item.keystorePassword ||
      (item.builderPubkey !== undefined && typeof item.builderPubkey !== "string") ||
      typeof item.deadlineBps !== "number" ||
      !Number.isSafeInteger(item.deadlineBps)
    )
      throw new YargsError(`Invalid gossip identity at index ${index}`);
    return {
      keystore: item.keystore,
      keystorePassword: item.keystorePassword,
      builderPubkey: item.builderPubkey,
      deadlineBps: item.deadlineBps,
    };
  });
}

export async function loadGossipIdentities(
  logger: Logger,
  filename?: string
): Promise<BuilderOptions["gossipIdentities"]> {
  if (!filename) return undefined;
  const data: unknown = JSON.parse(fs.readFileSync(filename, "utf8"));
  const identities: NonNullable<BuilderOptions["gossipIdentities"]> = [];
  for (const entry of parseGossipIdentities(data)) {
    const keypair = await loadBuilderKeypair(
      logger,
      path.resolve(path.dirname(filename), entry.keystore),
      path.resolve(path.dirname(filename), entry.keystorePassword),
      entry.builderPubkey
    );
    identities.push({keypair, deadlineBps: entry.deadlineBps});
  }
  return identities;
}
