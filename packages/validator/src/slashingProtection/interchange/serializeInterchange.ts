import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {InterchangeError, InterchangeErrorErrorCode} from "./errors";
import {Interchange, InterchangeFormatVersion, IInterchangeLodestar} from "./types";
import {serializeInterchangeCompleteV4} from "./formats/completeV4";
import {serializeInterchangeV5} from "./formats/v5";

export function serializeInterchange(
  config: IBeaconConfig,
  interchangeLodestar: IInterchangeLodestar,
  {format, version}: InterchangeFormatVersion
): Interchange {
  // version < v5.0.0
  if (format) {
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
    // version >= v5.0.0
  } else {
    switch (version) {
      case "5":
        return serializeInterchangeV5(config, interchangeLodestar);

      default:
        throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_VERSION, version});
    }
  }
}
