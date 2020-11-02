/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
const {initBLS} = require("@chainsafe/bls");

// Mocha.js: Root Hook Plugins
// The modern and parallel compatible way of running code before all tests

exports.mochaHooks = {
  beforeAll: [
    async function () {
      await initBLS();
    },
  ],
};
