import {Root, Uint64, Version} from "../../primitive/types";

export interface Genesis {
  genesisTime: Uint64;
  genesisValidatorsRoot: Root;
  genesisForkVersion: Version;
}
