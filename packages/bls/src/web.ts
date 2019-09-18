import bls from "./index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(function (window: any) {
  window.bls = bls;
  // @ts-ignore
})(window);
