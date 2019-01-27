git status

if output=$(git status --porcelain) && [ -z "$output" ]; then
  # Working directory clean
  exit 0
else
  # Uncommitted changes
  echo "Please update the API docs (npm run docs) and try again."
  exit 1
fi