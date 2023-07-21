#!/bin/bash

function start_app() {
  mkdir -p test-logs/e2e-test-env
  export LODESTAR_PRESET=minimal
  nohup node --loader ts-node/esm packages/cli/test/scripts/e2e_test_env.ts > test-logs/e2e-test-env/simulation.out 2>&1 &
  echo $! > test-logs/e2e-test-env/simulation.pid
  echo "Wait for the node to be ready"
  npx wait-port -t 60000 0.0.0.0:5001
}

function stop_app() {
  kill -9 $(cat test-logs/e2e-test-env/simulation.pid)
  # Incase the process pid file is not present
  kill -9 $(lsof -t -i:5001)
}



case "$1" in 
    start)   start_app ;;
    stop)    stop_app ;;
    *) echo "usage: $0 start|stop" >&2
       exit 1
       ;;
esac