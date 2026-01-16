set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(dirname "$SCRIPT_DIR")"
NPM_TOKEN_VALUE="$(grep NPM_TOKEN "$SCRIPT_DIR/.env.local" | cut -d '=' -f2)"

echo "Checking prerequisites..."
if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not running."
  exit 1
fi
echo "Docker is running."

echo "Running local TypeScript check (tsc --noEmit)..."
(
  cd "$SCRIPT_DIR" || exit 1
  npx tsc --noEmit
)

echo "Building Docker image..."
if [ -n "$NPM_TOKEN_VALUE" ]; then
  docker build \
    --build-arg NPM_TOKEN="$NPM_TOKEN_VALUE" \
    -t gwtemplate \
    -f "$SCRIPT_DIR/Dockerfile" \
    "$WORKSPACE_ROOT"
else
  docker build \
    -t gwtemplate \
    -f "$SCRIPT_DIR/Dockerfile" \
    "$WORKSPACE_ROOT"
fi
