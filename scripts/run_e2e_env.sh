#!/bin/bash

DIR="$(CDPATH= cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

function start_app() {
  mkdir -p test-logs/e2e-test-env
  export LODESTAR_PRESET=minimal
  export DOTENV_CONFIG_PATH="$DIR/../.env.test" 
  nohup node -r dotenv/config --loader ts-node/esm packages/cli/test/scripts/e2e_test_env.ts > test-logs/e2e-test-env/simulation.out 2>&1 &
  echo $! > test-logs/e2e-test-env/simulation.pid
  echo "Wait for the node to be ready"
  npx wait-port -t 120000 0.0.0.0:5001
}

function stop_app() {
  kill -s TERM $(cat test-logs/e2e-test-env/simulation.pid)
}

docker version > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "Docker is not running. Please start Docker and try again."
  exit 1
fi

case "$1" in 
    start)   start_app ;;
    stop)    stop_app ;;
    *) echo "usage: $0 start|stop" >&2
       exit 1
       ;;
esac