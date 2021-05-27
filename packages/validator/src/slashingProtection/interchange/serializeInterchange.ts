import {InterchangeError, InterchangeErrorErrorCode} from "./errors";
import {Interchange, InterchangeFormatVersion, IInterchangeLodestar} from "./types";
import {serializeInterchangeCompleteV4} from "./formats/completeV4";

export function serializeInterchange(
  interchangeLodestar: IInterchangeLodestar,
  {format, version}: InterchangeFormatVersion
): Interchange {
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
