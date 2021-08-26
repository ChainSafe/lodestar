#!/usr/bin/env bash

# Should ONLY run on CI/GA for releases, installing `jq` for Ubuntu latest
sudo apt install jq # sudo without password on ubuntu-latest

# Using the lodestar-cli packacke to reference against
declare PACKAGE="@chainsafe/lodestar-cli"

# Using `npm view -j` to get all available versions as JSON
declare CMD_NPM="npm view -j $PACKAGE"

# Using `jq` to get the latest version
declare VERSION_LATEST=$($CMD_NPM | jq -r '."dist-tags".latest')

# Usage: scripts/await-release.sh $VERSION $TIMEOUT
declare VERSION_EXPECTED=$(echo $1 | tr -d 'v')
declare TIMEOUT=$2

declare TIME=0
declare SLEEP=5

# Loop while package registry does not have what we want (yet)
### Note: that this script will already exit here in case everything is fine 
###       and only delay in case there is a discrepancy between the versions
while [[ "$VERSION_EXPECTED" != "$VERSION_LATEST" ]]; do
    echo "Expected version $VERSION_EXPECTED does not match latest version $VERSION_LATEST in NPM registry. Trying again in $SLEEP..."
    TIME=$(($TIME+$SLEEP))

    # Allow the CI to timeout
    if (( $TIME >= $TIMEOUT )); then
        echo "WARN: Timehout $TIME >= $TIMEOUT before finding correct version, NPM might fail..."
        break; # We don't want to exit yet, let the CI fail on NPM later
    fi
    sleep $SLEEP
    
    # Force clean cache before retrying
    npm cache clean --force
    VERSION_LATEST=$($CMD_NPM | jq -r '."dist-tags".latest')
done
