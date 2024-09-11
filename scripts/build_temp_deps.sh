SCRIPTS_DIR="$( cd "$( dirname "$0" )" && pwd )"
BLST_TS_DIR="$SCRIPTS_DIR/../temp-deps/blst-ts"
BLST_DIR="$BLST_TS_DIR/blst"


cd $BLST_DIR
chmod +x ./build.sh
./build.sh -ggdb

cd $BLST_TS_DIR
yarn
yarn build:debug