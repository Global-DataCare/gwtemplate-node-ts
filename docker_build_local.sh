set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(dirname "$SCRIPT_DIR")"
NPM_TOKEN_VALUE="$(grep NPM_TOKEN "$SCRIPT_DIR/.env.local" | cut -d '=' -f2)"
FORCE_NO_CACHE=false
CACHE_MARKER="$SCRIPT_DIR/.docker-build-deps.sha256"

if [[ "${1:-}" == "--no-cache" || "${1:-}" == "-n" ]]; then
  FORCE_NO_CACHE=true
fi

hash_deps() {
  local pkg="$SCRIPT_DIR/package.json"
  local lock="$SCRIPT_DIR/package-lock.json"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$pkg" "$lock"
  else
    sha256sum "$pkg" "$lock"
  fi
}

echo "Checking prerequisites..."
if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not running."
  exit 1
fi
echo "Docker is running."

DEPS_HASH="$(hash_deps | awk '{print $1}' | tr '\n' ' ')"
if [[ ! -f "$CACHE_MARKER" ]]; then
  FORCE_NO_CACHE=true
else
  CACHED_HASH="$(cat "$CACHE_MARKER")"
  if [[ "$DEPS_HASH" != "$CACHED_HASH" ]]; then
    FORCE_NO_CACHE=true
  fi
fi

echo "Running local TypeScript check (tsc --noEmit)..."
(
  cd "$SCRIPT_DIR" || exit 1
  npx tsc --noEmit
)

echo "Building Docker image..."
if [[ "$FORCE_NO_CACHE" == "true" ]]; then
  echo "Using --no-cache (dependency changes detected or flag provided)."
  NO_CACHE_FLAG="--no-cache"
else
  NO_CACHE_FLAG=""
fi

if [ -n "$NPM_TOKEN_VALUE" ]; then
  docker build \
    $NO_CACHE_FLAG \
    --build-arg NPM_TOKEN="$NPM_TOKEN_VALUE" \
    -t gwtemplate \
    -f "$SCRIPT_DIR/Dockerfile" \
    "$WORKSPACE_ROOT"
else
  docker build \
    $NO_CACHE_FLAG \
    -t gwtemplate \
    -f "$SCRIPT_DIR/Dockerfile" \
    "$WORKSPACE_ROOT"
fi

echo "$DEPS_HASH" > "$CACHE_MARKER"
