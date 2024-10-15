SCRIPTS_DIR="$( cd "$( dirname "$0" )" && pwd )"
BLST_TS_DIR="$SCRIPTS_DIR/../temp-deps/blst-ts"

cd $BLST_TS_DIR
yarn
yarn build