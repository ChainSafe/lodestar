SCRIPTS_DIR="$( cd "$( dirname "$0" )" && pwd )"
SWAP_OR_NOT_SHUFFLE_DIR="$SCRIPTS_DIR/../temp-deps/swap-or-not-shuffle"

cd $SWAP_OR_NOT_SHUFFLE_DIR
yarn
yarn build