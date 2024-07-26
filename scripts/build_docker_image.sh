COMMIT=$(git rev-parse HEAD) && docker buildx build . \
    --tag chainsafe/lodestar:$COMMIT \
    --platform linux/amd64,linux/arm64 \
    --build-arg COMMIT=$COMMIT
