# Our current release strategy does not gurantee that the tagged commit
# has the same version in the package.json.
# 
# If that's not the case, no version will be published to NPM and a faulty image will be published to dockerhub

LOCAL_VERSION=$(jq -r .version lerna.json)

if [ -z "$TAG" ]; then
  echo "ENV TAG is empty"
  exit 1
fi

if [[ $TAG == *"$LOCAL_VERSION"* ]]; then
  echo "TAG $TAG includes LOCAL_VERSION $LOCAL_VERSION"
  exit 0
else
  echo "TAG $TAG does not include LOCAL_VERSION $LOCAL_VERSION"
  exit 1
fi
