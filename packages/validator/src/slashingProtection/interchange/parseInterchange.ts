import {Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {isEqualRoot} from "../utils";
import {InterchangeError, InterchangeErrorErrorCode} from "./errors";
import {Interchange, IInterchangeLodestar} from "./types";
import {IInterchangeCompleteV4, parseInterchangeCompleteV4} from "./formats/completeV4";
import {IInterchangeV5, parseInterchangeV5} from "./formats/v5";

export function parseInterchange(
  config: IBeaconConfig,
  interchange: Interchange,
  expectedGenesisValidatorsRoot: Root
): IInterchangeLodestar {
  const format = (interchange as IInterchangeCompleteV4)?.metadata?.interchange_format;
  const version = interchange?.metadata?.interchange_format_version;

  // version < v5.0.0 (older version)
  if (format) {
    switch (format) {
      case "complete":
        switch (version) {
          case "4": {
            const interchangeLodestar = parseInterchangeCompleteV4(config, interchange as IInterchangeCompleteV4);
            if (!isEqualRoot(config, interchangeLodestar.genesisValidatorsRoot, expectedGenesisValidatorsRoot)) {
              throw new InterchangeError({
                code: InterchangeErrorErrorCode.GENESIS_VALIDATOR_MISMATCH,
                root: interchangeLodestar.genesisValidatorsRoot,
                extectedRoot: expectedGenesisValidatorsRoot,
              });
            }
            return interchangeLodestar;
          }

          default:
            throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_VERSION, version});
        }

      default:
        throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_FORMAT, format: format});
    }
  } else {
    // version >= v5.0.0
    switch (version) {
      case "5": {
        const interchangeLodestar = parseInterchangeV5(config, interchange as IInterchangeV5);
        if (!isEqualRoot(config, interchangeLodestar.genesisValidatorsRoot, expectedGenesisValidatorsRoot)) {
          throw new InterchangeError({
            code: InterchangeErrorErrorCode.GENESIS_VALIDATOR_MISMATCH,
            root: interchangeLodestar.genesisValidatorsRoot,
            extectedRoot: expectedGenesisValidatorsRoot,
          });
        }
        return interchangeLodestar;
      }

      default:
        throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_VERSION, version});
    }
  }
}
