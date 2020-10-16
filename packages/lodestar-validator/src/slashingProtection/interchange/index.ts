import {Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {isEqualRoot} from "../utils";
import {IInterchangeLodestar} from "./types";
import {InterchangeError, InterchangeErrorErrorCode} from "./errors";
import {IInterchangeCompleteV4, parseInterchangeCompleteV4, serializeInterchangeCompleteV4} from "./formats/completeV4";

export type Interchange = IInterchangeCompleteV4;
export type InterchangeFormatVersion = {format: "complete"; version: "4"};
export {IInterchangeLodestar, InterchangeError, InterchangeErrorErrorCode};

export function parseInterchange(
  config: IBeaconConfig,
  interchange: Interchange,
  expectedGenesisValidatorsRoot: Root
): IInterchangeLodestar {
  const format = interchange?.metadata?.interchange_format;
  const version = interchange?.metadata?.interchange_format_version;

  switch (format) {
    case "complete":
      switch (version) {
        case "4": {
          const interchangeLodestar = parseInterchangeCompleteV4(config, interchange);
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
      throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_FORMAT, format});
  }
}

export function serializeInterchange(
  config: IBeaconConfig,
  interchangeLodestar: IInterchangeLodestar,
  {format, version}: InterchangeFormatVersion
): Interchange {
  switch (format) {
    case "complete":
      switch (version) {
        case "4":
          return serializeInterchangeCompleteV4(config, interchangeLodestar);

        default:
          throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_VERSION, version});
      }

    default:
      throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_FORMAT, format});
  }
}
