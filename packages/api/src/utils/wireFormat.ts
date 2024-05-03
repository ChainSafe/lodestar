import {MediaType} from "./headers.js";

export enum WireFormat {
  json = "json",
  ssz = "ssz",
}

export function getWireFormat(mediaType: MediaType): WireFormat {
  switch (mediaType) {
    case MediaType.json:
      return WireFormat.json;
    case MediaType.ssz:
      return WireFormat.ssz;
  }
}
