export * from "../../beacon/cmds/run/options/chain";

export interface IChainArgs {
  chain?: {
    name?: string;
    genesisStateFile?: string;
  };
}
