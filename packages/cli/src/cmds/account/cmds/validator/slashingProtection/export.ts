import {InterchangeFormatVersion} from "@chainsafe/lodestar-validator";
import {ICliCommand, writeFile} from "../../../../../util/index.js";
import {IGlobalArgs} from "../../../../../options/index.js";
import {IAccountValidatorArgs} from "../options.js";
import {ISlashingProtectionArgs} from "./options.js";
import {getGenesisValidatorsRoot, getSlashingProtection} from "./utils.js";

/* eslint-disable no-console */

interface IExportArgs {
  file: string;
}

export const exportCmd: ICliCommand<IExportArgs, ISlashingProtectionArgs & IAccountValidatorArgs & IGlobalArgs> = {
  command: "export",

  describe: "Export an interchange file.",

  examples: [
    {
      command: "account validator slashing-protection export --network prater --file interchange.json",
      description: "Export an interchange JSON file for all validators in the slashing protection DB",
    },
  ],

  options: {
    file: {
      description: "The slashing protection interchange file to export to (.json).",
      demandOption: true,
      type: "string",
    },
  },

  handler: async (args) => {
    const genesisValidatorsRoot = await getGenesisValidatorsRoot(args);
    const slashingProtection = getSlashingProtection(args);

    // TODO: Allow format version and pubkeys to be customized with CLI args
    const formatVersion: InterchangeFormatVersion = {version: "4", format: "complete"};
    const pubkeys = await slashingProtection.listPubkeys();

    const interchange = await slashingProtection.exportInterchange(genesisValidatorsRoot, pubkeys, formatVersion);
    writeFile(args.file, interchange);

    console.log("Export completed successfully");
  },
};
