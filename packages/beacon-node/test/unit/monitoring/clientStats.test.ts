import {expect} from "chai";
import {ClientStats} from "../../../src/monitoring/types.js";
import {createClientStats} from "../../../src/monitoring/clientStats.js";
import {beaconNodeStatsSchema, ClientStatsSchema, systemStatsSchema, validatorStatsSchema} from "./schemas.js";

describe("monitoring / clientStats", () => {
  describe("BeaconNodeStats", () => {
    it("should contain all required keys", () => {
      const beaconNodeStats = createClientStats("beacon")[0];

      expect(getJsonKeys(beaconNodeStats)).to.have.all.members(getSchemaKeys(beaconNodeStatsSchema));
    });
  });

  describe("ValidatorStats", () => {
    it("should contain all required keys", () => {
      const validatorNodeStats = createClientStats("validator")[0];

      expect(getJsonKeys(validatorNodeStats)).to.have.all.members(getSchemaKeys(validatorStatsSchema));
    });
  });

  describe("SystemStats", () => {
    it("should contain all required keys", () => {
      const systemStats = createClientStats("beacon", true)[1];

      expect(getJsonKeys(systemStats)).to.have.all.members(getSchemaKeys(systemStatsSchema));
    });
  });
});

function getJsonKeys(stats: ClientStats): string[] {
  return Object.values(stats).map((property) => property.definition.jsonKey);
}

function getSchemaKeys(schema: ClientStatsSchema): string[] {
  return schema.map((s) => s.key);
}
