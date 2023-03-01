import {Root} from "@lodestar/types";
import {isEqualRoot} from "../utils.js";
import {InterchangeError, InterchangeErrorErrorCode} from "./errors.js";
import {Interchange, InterchangeLodestar} from "./types.js";
import {InterchangeCompleteV4, parseInterchangeCompleteV4} from "./formats/completeV4.js";
import {InterchangeV5, parseInterchangeV5} from "./formats/v5.js";

export function parseInterchange(interchange: Interchange, expectedGenesisValidatorsRoot: Root): InterchangeLodestar {
  const format = (interchange as InterchangeCompleteV4)?.metadata?.interchange_format;
  const version = interchange?.metadata?.interchange_format_version;

  if (!format) {
    // version >= v5.0.0
    switch (version) {
      case "5": {
        const interchangeLodestar = parseInterchangeV5(interchange as InterchangeV5);
        if (!isEqualRoot(interchangeLodestar.genesisValidatorsRoot, expectedGenesisValidatorsRoot)) {
          throw new InterchangeError({
            code: InterchangeErrorErrorCode.GENESIS_VALIDATOR_MISMATCH,
            root: interchangeLodestar.genesisValidatorsRoot,
            expectedRoot: expectedGenesisValidatorsRoot,
          });
        }
        return interchangeLodestar;
      }

      default:
        throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_VERSION, version});
    }
  }

  // version < v5.0.0 (older version)
  switch (format) {
    case "complete":
      switch (version) {
        case "4": {
          const interchangeLodestar = parseInterchangeCompleteV4(interchange as InterchangeCompleteV4);
          if (!isEqualRoot(interchangeLodestar.genesisValidatorsRoot, expectedGenesisValidatorsRoot)) {
            throw new InterchangeError({
              code: InterchangeErrorErrorCode.GENESIS_VALIDATOR_MISMATCH,
              root: interchangeLodestar.genesisValidatorsRoot,
              expectedRoot: expectedGenesisValidatorsRoot,
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
}
