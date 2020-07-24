import {Options} from "yargs";

export interface IGenesisStateFileOptions {
  chain: {
    genesisStateFile?: string;
  };
}

export const genesisStateFileOptions = {
  "chain.genesisStateFile": {
    description: "Genesis state in ssz-encoded format",
    type: "string",
    normalize: true,
  } as Options,
};
