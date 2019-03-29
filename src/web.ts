import {
  hashTreeRoot,
  deserialize,
  serialize,
  Type,
  parseType,
} from "./index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(function (window: any) {
  window.ssz = {
    hashTreeRoot,
    deserialize,
    serialize,
    Type,
    parseType,
  }
})(window)
