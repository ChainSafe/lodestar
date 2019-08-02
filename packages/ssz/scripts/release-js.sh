#!/bin/bash

# To consider:
# https://gist.github.com/Jaskaranbir/d5b065173b3a6f164e47a542472168c1

# Assumes that built web assets are outputed to `./dist/`
# Assumes that built node assets are outputed to `./lib/`
# Assumes that package.json properly represents `current_version` & `name`

LAST_RELEASE_TAG=$(curl https://api.github.com/repos/$TRAVIS_REPO_SLUG/releases/latest 2>/dev/null | jq .name | sed 's/"//g')

# ===> Set these variables first
branch="$GIT_BRANCH"
repo_slug="$TRAVIS_REPO_SLUG"
token="$API_TOKEN"
version="$TRAVIS_TAG"

REPO_NAME=$(node -p -e "require('./package.json').name")
VERSION=$(node -p -e "require('./package.json').version")
DIST_NAME="web-$REPO_NAME-$VERSION"
LIB_NAME="nodejs-$REPO_NAME-$VERSION"

# An automatic changelog generator
gem install github_changelog_generator

# Pre-Cleanup
echo "Performing pre-cleanup..."
rm -rf ./CHANGELOG.md
rm -rf ./artifacts/

# Create directory where all artifacts will be stored
mkdir ./artifacts/

# Create changelog
touch CHANGELOG.md

# Generate CHANGELOG.md
echo "Generating CHANGELOG..."
github_changelog_generator -u $(cut -d "/" -f1 <<< $repo_slug) -p $(cut -d "/" -f2 <<< $repo_slug) --token $token --since-tag ${LAST_RELEASE_TAG}

# Add SHA table to CHANGELOG.md
echo "|System|Binary|SHA256 Checksum|" >> CHANGELOG.md
echo "|------|------|---------------|" >> CHANGELOG.md

# Duplicate `./dist`
cp -rv ./dist ./$DIST_NAME

# Generate checksums for all files in `./dist`
echo "Generating checsums for ./dist..."
cd ./$DIST_NAME
for dist_file in *; do
    sha256sum $dist_file > $dist_file.sha256
done
cd ..

# Tarbal cloned `./dist` and move to `./artifacts/`
echo "Zipping ./artifacts..."
tar -zcvf ./artifacts/$DIST_NAME.tar.gz $DIST_NAME
echo "Generating checksum for ./artifacts..."
sha256sum ./artifacts/$DIST_NAME.tar.gz > ./artifacts/$DIST_NAME.sha256

# Append tarball and SHA to CHANGELOG.md
echo "Adding ./dist contents to CHANGELOG..."
shaArr=$(cat ./artifacts/$DIST_NAME.sha256)
sha=$(${shaArr//;/ })
row="|WEB|$DIST_NAME.tar.gz|$sha|"
echo $row >> CHANGELOG.md

# Duplicate `./lib`
echo "Copying lib..."
cp -rv ./lib ./$LIB_NAME

# Generate tarball & checksum for `./lib`
echo "Zipping ./lib..."
tar -zcvf ./artifacts/$LIB_NAME.tar.gz $LIB_NAME
echo "Generating checksum for ./lib..."
sha256sum ./artifacts/$LIB_NAME.tar.gz > ./artifacts/$LIB_NAME.sha256

# Append tarball and SHA to CHANGELOG.md
echo "Adding ./lib contents to CHANGELOG..."
shaArr=$(cat ./artifacts/$LIB_NAME.sha256)
sha=$(${shaArr//;/ })
row="|NodeJS|$LIB_NAME.tar.gz|$sha|"
echo $row >> CHANGELOG.md

# Cleanup
echo "Performing cleanup..."
rm -rf ./$DIST_NAME ./$LIB_NAME

# Get CHANGELOG.md body
body="$(cat CHANGELOG.md)"

# Overwrite CHANGELOG.md with JSON data for GitHub API
echo "Generating JSON for CHANGELOG..."
jq -n \
  --arg body "$body" \
  --arg name "$version" \
  --arg tag_name "$version" \
  --arg target_commitish "$branch" \
  '{
    body: $body,
    name: $name,
    tag_name: $tag_name,
    target_commitish: $target_commitish,
    draft: true,
    prerelease: false
  }' > CHANGELOG.md

# Deploy new release
echo "Create release $version for repo: $repo_slug, branch: $branch"
curl -H "Authorization: token $token" --data @CHANGELOG.md "https://api.github.com/repos/$repo_slug/releases"
