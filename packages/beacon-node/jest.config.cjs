// Jest configuration for api
const base = require("../../jest.config.base.cjs");

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...base,
  displayName: "beacon-node",
};
