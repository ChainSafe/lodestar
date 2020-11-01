import {runFinalityTests1} from "./finality_fast";

// Split finality tests in two files so mocha --parallel can paralelize them

runFinalityTests1();
