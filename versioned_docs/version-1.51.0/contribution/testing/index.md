# Testing

Testing is critical to the Lodestar project and there are many types of tests that are run to build a product that is both effective AND efficient. This page will help to break down the different types of tests you will find in the Lodestar repo.

There are a few flags you can set through env variables to override behavior of testing and its output.

| ENV variable        | Effect | Impact                                                                                                                    |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| TEST_COMPACT_DIFF   | All    | Will strip down the object difference rendered during test failures. Very useful for large object matching.               |
| TEST_QUIET_CONSOLE  | All    | Will strip down console output. Reduce console flickering.                                                                |
| TEST_COMPACT_OUTPUT | All    | Display a condensed summary of tests run. Use vitest [basic](https://vitest.dev/guide/reporters#basic-reporter) reporter. |

### Unit Tests

This is the most fundamental type of test in most code bases. In all instances mocks, stubs and other forms of isolation are used to test code on a functional, unit level. See the [Unit Tests](./unit-tests.md) page for more information.

### Spec Tests

The Ethereum Consensus Specifications are what ensure that the various consensus clients do not diverge on critical computations and will work harmoniously on the network. See the [Spec Tests](./spec-tests.md) page for more information.

### Performance Tests

Node.js is an unforgiving virtual machine when it comes to high performance, multi-threaded applications. In order to ensure that Lodestar can not only keep up with the chain, but to push the boundary of what is possible, there are lots of performance tests that benchmark programming paradigms and prevent regression. See the [Performance Testing](./performance-tests.md) page for more information.

### End-To-End Tests

E2E tests are where Lodestar is run in its full form, often from the CLI as a user would to check that the system as a whole works as expected. These tests are meant to exercise the entire system in isolation and there is no network interaction, nor interaction with any other code outside of Lodestar. See the [End-To-End Testing](./end-to-end-tests.md) page for more information.

### Integration Tests

Integration tests are meant to test how Lodestar interacts with other clients, but are not considered full simulations. This is where Lodestar may make API calls or otherwise work across the process boundary, but there is required mocking, stubbing, or class isolation. An example of this is using the `ExecutionEngine` class to make API calls to a Geth instance to check that the http requests are properly formatted.

### Simulation Tests

These are the most comprehensive types of tests. They aim to test Lodestar in a fully functioning ephemeral devnet environment. See the [Simulation Testing](./simulation-tests.md) page for more information.
