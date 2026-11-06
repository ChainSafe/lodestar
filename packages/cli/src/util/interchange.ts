import {readFile} from "node:fs/promises";
import {BLSPubkey, Root} from "@lodestar/types";
import {CliOptionDefinition, Logger, toPubkeyHex} from "@lodestar/utils";
import {ISlashingProtection, Interchange, InterchangeFormatVersion} from "@lodestar/validator";
import {YargsError} from "./errors.js";
import {writeFile600Perm} from "./file.js";
import {ensure0xPrefix, isValidatePubkeyHex} from "./format.js";

export const interchangeFormatVersion: InterchangeFormatVersion = {version: "5"};

export const interchangeFileOption: CliOptionDefinition<string> & {demandOption: true} = {
  description: "The slashing protection interchange file (.json)",
  demandOption: true,
  type: "string",
};

export const interchangePubkeysOption: CliOptionDefinition<string[]> = {
  description: "Export slashing protection data only for a given subset of public keys",
  type: "array",
  string: true, // Ensures the pubkey string is not automatically converted to numbers
  coerce: (pubkeys: string[]): string[] =>
    // Parse ["0x11,0x22"] to ["0x11", "0x22"]
    pubkeys.flatMap((item) => item.split(",")).map(ensure0xPrefix),
};

export async function readInterchangeFile(file: string, logger: Logger): Promise<Interchange> {
  logger.verbose("Reading slashing protection data", {file});
  return JSON.parse(await readFile(file, "utf8")) as Interchange;
}

export async function exportInterchangeFile(
  slashingProtection: ISlashingProtection & {listPubkeys(): Promise<BLSPubkey[]>},
  genesisValidatorsRoot: Root,
  {file, pubkeys}: {file: string; pubkeys?: string[]},
  logger: Logger
): Promise<void> {
  logger.verbose("Fetching pubkeys from slashing protection db");
  const allPubkeys = await slashingProtection.listPubkeys();
  let pubkeysToExport = allPubkeys;

  if (pubkeys) {
    logger.verbose("Filtering by pubkeys from args", {count: pubkeys.length});
    const filteredPubkeys = [];

    for (const pubkeyHex of pubkeys) {
      if (!isValidatePubkeyHex(pubkeyHex)) {
        throw new YargsError(`Invalid pubkey ${pubkeyHex}`);
      }
      const existingPubkey = allPubkeys.find((pubkey) => toPubkeyHex(pubkey) === pubkeyHex);
      if (!existingPubkey) {
        logger.warn("Pubkey not found in slashing protection db", {pubkey: pubkeyHex});
      } else {
        filteredPubkeys.push(existingPubkey);
      }
    }

    pubkeysToExport = filteredPubkeys;
  }

  logger.info("Starting export for pubkeys found", {count: pubkeysToExport.length});
  const interchange = await slashingProtection.exportInterchange(
    genesisValidatorsRoot,
    pubkeysToExport,
    interchangeFormatVersion,
    logger
  );

  logger.info("Writing slashing protection data", {file});
  writeFile600Perm(file, interchange);
  logger.info("Export completed successfully");
}
