COMMIT=$(jj log -r @ --no-graph -T 'commit_id')
echo ${COMMIT}

docker buildx build . --push \
  --tag bhbhbhbhbhbh/lodestar:${COMMIT}\
  --platform linux/amd64 \
  --build-arg COMMIT=${COMMIT}
