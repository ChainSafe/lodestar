import {InterchangeError, InterchangeErrorErrorCode} from "./errors.js";
import {Interchange, InterchangeFormatVersion, IInterchangeLodestar} from "./types.js";
import {serializeInterchangeCompleteV4} from "./formats/completeV4.js";
import {serializeInterchangeV5} from "./formats/v5.js";

export function serializeInterchange(
  interchangeLodestar: IInterchangeLodestar,
  {format, version}: InterchangeFormatVersion
): Interchange {
  // version >= v5.0.0
  if (!format) {
    switch (version) {
      case "5":
        return serializeInterchangeV5(interchangeLodestar);

      default:
        throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_VERSION, version});
    }
  }

  // version < v5.0.0
  switch (format) {
    case "complete":
      switch (version) {
        case "4":
          return serializeInterchangeCompleteV4(interchangeLodestar);

        default:
          throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_VERSION, version});
      }

    default:
      throw new InterchangeError({code: InterchangeErrorErrorCode.UNSUPPORTED_FORMAT, format});
  }
}
