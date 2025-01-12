#!/usr/bin/env bash

# Should ONLY run on CI/GA for releases, installing `jq` for Ubuntu latest
sudo apt install -y jq # sudo without password on ubuntu-latest

# Using the lodestar-cli package to reference against
declare PACKAGE="@chainsafe/lodestar"

# Using `npm view -j` to get all available versions as JSON
declare CMD_NPM="npm view -j $PACKAGE"

# Usage: scripts/await-release.sh $VERSION $DIST_TAG $TIMEOUT
if [[ -z "$1" ]]; then
    echo "Error: Expected version (argument 1) is not set."
    exit 1
fi
declare VERSION_EXPECTED=$(echo $1 | tr -d 'v')

if [[ -z "$2" ]]; then
    echo "Error: Dist tag (argument 2) is not set."
    exit 1
fi
declare DIST_TAG=$2

if [[ -z "$3" ]]; then
    echo "Error: Timeout (argument 3) is not set."
    exit 1
fi
declare TIMEOUT=$3

# Using `jq` to get the dist-tag version
declare VERSION_LATEST=$($CMD_NPM | jq -r ".\"dist-tags\".$DIST_TAG") || {
    echo "Error: Failed to fetch version from NPM registry."
    exit 1
}

declare TIME=0
declare SLEEP=5

# Loop while package registry does not have what we want (yet)
### Note: that this script will already exit here in case everything is fine 
###       and only delay in case there is a discrepancy between the versions
while [[ "$VERSION_EXPECTED" != "$VERSION_LATEST" ]]; do
    echo "Expected version $VERSION_EXPECTED does not match $DIST_TAG version $VERSION_LATEST in NPM registry. Trying again in $SLEEP..."
    TIME=$(($TIME+$SLEEP))

    # Allow the CI to timeout
    if (( $TIME >= $TIMEOUT )); then
        echo "WARN: Timeout $TIME >= $TIMEOUT before finding correct version, NPM might fail..."
        break; # We don't want to exit yet, let the CI fail on NPM later
    fi
    sleep $SLEEP
    
    # Fetch the latest version again
    VERSION_LATEST=$($CMD_NPM | jq -r ".\"dist-tags\".$DIST_TAG") || {
        echo "Error: Failed to fetch version from NPM registry."
        exit 1
    }
done
