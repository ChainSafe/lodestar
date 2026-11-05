import bindings from "./bindings.js";

const native = bindings.metrics;

export const init = native.init;
export const scrapeMetrics = native.scrapeMetrics;
export const registerLocalValidator = native.registerLocalValidator;
export const unregisterLocalValidator = native.unregisterLocalValidator;
