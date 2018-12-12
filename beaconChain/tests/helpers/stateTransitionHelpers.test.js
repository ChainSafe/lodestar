"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
var chai_1 = require("chai");
var enums_1 = require("../../constants/enums");
var stateTransitionHelpers_1 = require("../../helpers/stateTransitionHelpers");
describe("Split", function () {
    it("array of 0 should return empty", function () {
        var array = [];
        var answer = [[]];
        var result = stateTransitionHelpers_1.split(array, 1);
        chai_1.assert.deepEqual(result, answer);
    });
    it("array of 10 should split by a count of 1", function () {
        var array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        var answer = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
        var result = stateTransitionHelpers_1.split(array, 1);
        chai_1.assert.deepEqual(result, answer);
    });
    it("array of 10 should split by a count of 2", function () {
        var array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        var answer = [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]];
        var result = stateTransitionHelpers_1.split(array, 2);
        chai_1.assert.deepEqual(result, answer);
    });
    it("array of 10 should split by a count of 3", function () {
        var array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        var answer = [[1, 2, 3], [4, 5, 6], [7, 8, 9, 10]];
        var result = stateTransitionHelpers_1.split(array, 3);
        chai_1.assert.deepEqual(result, answer);
    });
    it("array of 10 should split by a count of 4", function () {
        var array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        var answer = [[1, 2], [3, 4, 5], [6, 7], [8, 9, 10]];
        var result = stateTransitionHelpers_1.split(array, 4);
        chai_1.assert.deepEqual(result, answer);
    });
    it("array of 7 should split by a count of 1", function () {
        var array = [1, 2, 3, 4, 5, 6, 7];
        var answer = [[1, 2, 3, 4, 5, 6, 7]];
        var result = stateTransitionHelpers_1.split(array, 1);
        chai_1.assert.deepEqual(result, answer);
    });
    it("array of 7 should split by a count of 2", function () {
        var array = [1, 2, 3, 4, 5, 6, 7];
        var answer = [[1, 2, 3], [4, 5, 6, 7]];
        var result = stateTransitionHelpers_1.split(array, 2);
        chai_1.assert.deepEqual(result, answer);
    });
    it("array of 7 should split by a count of 3", function () {
        var array = [1, 2, 3, 4, 5, 6, 7];
        var answer = [[1, 2], [3, 4], [5, 6, 7]];
        var result = stateTransitionHelpers_1.split(array, 3);
        chai_1.assert.deepEqual(result, answer);
    });
    it("array of 7 should split by a count of 4", function () {
        var array = [1, 2, 3, 4, 5, 6, 7];
        var answer = [[1], [2, 3], [4, 5], [6, 7]];
        var result = stateTransitionHelpers_1.split(array, 4);
        chai_1.assert.deepEqual(result, answer);
    });
});
describe("Clamp", function () {
    it("should return upper bound", function () {
        var result = stateTransitionHelpers_1.clamp(2, 4, 5);
        chai_1.assert.equal(result, 4, "Should have returned 4!");
    });
    it("should return upper bound", function () {
        var result = stateTransitionHelpers_1.clamp(2, 4, 4);
        chai_1.assert.equal(result, 4, "Should have returned 4!");
    });
    it("should return the lower bound", function () {
        var result = stateTransitionHelpers_1.clamp(2, 4, 1);
        chai_1.assert.equal(result, 2, "Should have returned 2!");
    });
    it("should return the lower bound", function () {
        var result = stateTransitionHelpers_1.clamp(2, 4, 2);
        chai_1.assert.equal(result, 2, "Should have returned 2!");
    });
    it("should return the inbetween value", function () {
        var result = stateTransitionHelpers_1.clamp(2, 4, 3);
        chai_1.assert.equal(result, 3, "Should have returned 3!");
    });
});
describe("intSqrt", function () {
    it("0 should return 0", function () {
        var result = stateTransitionHelpers_1.intSqrt(0);
        chai_1.assert.equal(result, 0, "Should have returned 0!");
    });
    it("1 should return 1", function () {
        var result = stateTransitionHelpers_1.intSqrt(1);
        chai_1.assert.equal(result, 1, "Should have returned 1!");
    });
    it("3 should return 1", function () {
        var result = stateTransitionHelpers_1.intSqrt(3);
        chai_1.assert.equal(result, 1, "Should have returned 1!");
    });
    it("4 should return 2", function () {
        var result = stateTransitionHelpers_1.intSqrt(4);
        chai_1.assert.equal(result, 2, "Should have returned 2!");
    });
    it("16 should return 4", function () {
        var result = stateTransitionHelpers_1.intSqrt(16);
        chai_1.assert.equal(result, 4, "Should have returned 4!");
    });
    it("31 should return 5", function () {
        var result = stateTransitionHelpers_1.intSqrt(31);
        chai_1.assert.equal(result, 5, "Should have returned 5!");
    });
});
describe("getActiveValidatorIndices", function () {
    var randNum = function () { return Math.floor(Math.random() * Math.floor(4)); };
    var genValidatorRecord = function () { return ({
        balance: randNum(),
        exitCount: randNum(),
        lastStatusChangeSlot: randNum(),
        pubkey: randNum(),
        randaoCommitment: randNum(),
        randaoSkips: randNum(),
        status: randNum(),
        withdrawalCredentials: randNum(),
    }); };
    var vrArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(genValidatorRecord);
    it("empty list of ValidatorRecords should return no indices (empty list)", function () {
        chai_1.assert.deepEqual(stateTransitionHelpers_1.getActiveValidatorIndices([]), []);
    });
    it("list of all active ValidatorRecords should return a list of all indices", function () {
        var allActive = vrArray.map(function (vr) { return (__assign({}, vr, { status: enums_1.ValidatorStatusCodes.ACTIVE })); });
        var indices = vrArray.map(function (_, i) { return i; });
        var activeIndices = stateTransitionHelpers_1.getActiveValidatorIndices(allActive);
        chai_1.assert.equal(allActive.length, activeIndices.length);
        chai_1.assert.deepEqual(indices, activeIndices);
    });
    it("list of no active ValidatorRecords should return an empty list", function () {
        var noActive = vrArray.map(function (vr) { return (__assign({}, vr, { status: enums_1.ValidatorStatusCodes.PENDING_ACTIVATION })); });
        chai_1.assert.deepEqual(stateTransitionHelpers_1.getActiveValidatorIndices(noActive), []);
    });
    it("list of random mixed ValidatorRecords should return a filtered and mutated list", function () {
        var filtered = vrArray.filter(function (vr) { return vr.status === enums_1.ValidatorStatusCodes.ACTIVE; });
        var getAVI = stateTransitionHelpers_1.getActiveValidatorIndices(vrArray);
        chai_1.assert(filtered.length === getAVI.length);
    });
});
//# sourceMappingURL=stateTransitionHelpers.test.js.map