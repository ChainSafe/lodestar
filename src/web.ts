import {
  hashTreeRoot,
  deserialize,
  serialize,
} from "./index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(function (window: any) {
  window.ssz = {
    hashTreeRoot,
    deserialize,
    serialize,
  }
})(window)
