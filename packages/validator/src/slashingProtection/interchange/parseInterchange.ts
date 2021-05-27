import {Root} from "@chainsafe/lodestar-types";
import {isEqualRoot} from "../utils";
import {InterchangeError, InterchangeErrorErrorCode} from "./errors";
import {Interchange, IInterchangeLodestar} from "./types";
import {parseInterchangeCompleteV4} from "./formats/completeV4";

export function parseInterchange(interchange: Interchange, expectedGenesisValidatorsRoot: Root): IInterchangeLodestar {
  const format = interchange?.metadata?.interchange_format;
  const version = interchange?.metadata?.interchange_format_version;

  switch (format) {
    case "complete":
      switch (version) {
        case "4": {
          const interchangeLodestar = parseInterchangeCompleteV4(interchange);
          if (!isEqualRoot(interchangeLodestar.genesisValidatorsRoot, expectedGenesisValidatorsRoot)) {
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
      throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_FORMAT, format});
  }
}
