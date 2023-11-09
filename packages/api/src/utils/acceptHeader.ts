import {ResponseFormat} from "../interfaces.js";

enum MediaType {
  json = "application/json",
  ssz = "application/octet-stream",
}

const MEDIA_TYPES: {
  [K in ResponseFormat]: MediaType;
} = {
  json: MediaType.json,
  ssz: MediaType.ssz,
};

function responseFormatFromMediaType(mediaType: MediaType): ResponseFormat {
  switch (mediaType) {
    default:
    case MediaType.json:
      return "json";
    case MediaType.ssz:
      return "ssz";
  }
}

export function writeAcceptHeader(format?: ResponseFormat): MediaType {
  return format === undefined ? MEDIA_TYPES["json"] : MEDIA_TYPES[format];
}

export function parseAcceptHeader(accept?: string): ResponseFormat {
  // Use json by default.
  if (!accept) {
    return "json";
  }

  const mediaTypes = Object.values(MediaType);

  // Respect Quality Values per RFC-9110
  // Acceptable mime-types are comma separated with optional whitespace
  return responseFormatFromMediaType(
    accept
      .toLowerCase()
      .split(",")
      .map((x) => x.trim())
      .reduce(
        (best: [number, MediaType], current: string): [number, MediaType] => {
          // An optional `;` delimiter is used to separate the mime-type from the weight
          // Normalize here, using 1 as the default qvalue
          const quality = current.includes(";") ? current.split(";") : [current, "q=1"];

          const mediaType = quality[0].trim() as MediaType;

          // If the mime type isn't acceptable, move on to the next entry
          if (!mediaTypes.includes(mediaType)) {
            return best;
          }

          // Otherwise, the portion after the semicolon has optional whitespace and the constant prefix "q="
          const weight = quality[1].trim();
          if (!weight.startsWith("q=")) {
            // If the format is invalid simply move on to the next entry
            return best;
          }

          const qvalue = +weight.replace("q=", "");
          if (isNaN(qvalue) || qvalue > 1 || qvalue <= 0) {
            // If we can't convert the qvalue to a valid number, move on
            return best;
          }

          if (qvalue < best[0]) {
            // This mime type is not preferred
            return best;
          }

          // This mime type is preferred
          return [qvalue, mediaType];
        },
        [0, MediaType.json]
      )[1]
  );
}
