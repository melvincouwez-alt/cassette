# List available recipes
default:
    @just --list

# Install project dependencies
install:
    npm install

# Build TypeScript into dist/ and write credentials because npx tsc runs no npm hook
build:
    node scripts/inject-lastfm-credentials.cjs
    npx tsc

# Run the app (builds first)
run: build
    npx electron .

# Run with debug logging to file
run-debug: build
    ELECTRON_LOG_LEVEL=debug npx electron .

# Run with DevTools open (builds first)
run-devtools: build
    CASSETTE_DEVTOOLS=1 npx electron .

# Run with debug logging and DevTools (builds first)
run-inspect: build
    ELECTRON_LOG_LEVEL=debug CASSETTE_DEVTOOLS=1 npx electron .

# Run without building (use after initial build for faster iteration)
run-fast:
    npx electron .

# Run with CDP exposed for Playwright attach (builds first)
run-cdp PORT="9222": build
    npx electron . --remote-debugging-port={{PORT}} --remote-debugging-address=127.0.0.1

# Run with CDP, debug logging, and DevTools (builds first)
run-cdp-inspect PORT="9222": build
    ELECTRON_LOG_LEVEL=debug CASSETTE_DEVTOOLS=1 npx electron . --remote-debugging-port={{PORT}} --remote-debugging-address=127.0.0.1

# Run with CDP without building (use after initial build for faster iteration)
run-cdp-fast PORT="9222":
    npx electron . --remote-debugging-port={{PORT}} --remote-debugging-address=127.0.0.1

# Watch TypeScript for changes and rebuild
watch:
    npx tsc --watch

# Run static checks
lint:
    npx tsc --noEmit
    npx tsc -p tsconfig.test.json --noEmit

# Run tests
test:
    npm test

# npm audit omits devDependencies even when a dependency, such as electron, ships.
# Validate electron-builder configuration and audit runtime dependencies
validate:
    @ELECTRON_SKIP_BINARY_DOWNLOAD=1 node scripts/validate-build-config.cjs
    npm audit --omit=dev

# Generate tray menu icon PNGs from SVG sources
generate-menu-icons:
    #!/usr/bin/env bash
    set -euo pipefail
    src="assets/source/tray-menu"
    out="assets/icons/tray/menu"
    for svg in "$src"/*.svg; do
        name=$(basename "$svg" .svg)
        for variant in light dark; do
            dir="$out/$variant"
            mkdir -p "$dir"
            if [ "$variant" = "dark" ]; then
                sed 's/<svg /<svg fill="#FFFFFF" /' "$svg" \
                    | rsvg-convert -w 64 -h 64 -o "$dir/$name.png"
            else
                rsvg-convert -w 64 -h 64 -o "$dir/$name.png" "$svg"
            fi
            optipng -strip all -o7 -quiet "$dir/$name.png"
        done
    done

# Clean build artefacts
clean:
    rm -rf dist/

# The cache directory is lowercase because src/artwork.ts builds it from app.getName().toLowerCase()
# Clear all Cassette user data and caches
clear:
    rm -rf ~/.config/Cassette
    rm -rf ~/.cache/cassette
    @echo "Cassette data cleared"

# Build a local development package with a -dev version
package: build
    #!/usr/bin/env bash
    set -euo pipefail

    base_version=$(node -p "require('./package.json').version")
    commit_count=$(git rev-list --count HEAD)
    short_hash=$(git rev-parse --short HEAD)
    dev_version="${base_version}-dev.${commit_count}.${short_hash}"

    trap 'npm version "$base_version" --no-git-tag-version --allow-same-version >/dev/null 2>&1' EXIT

    npm version "$dev_version" --no-git-tag-version --allow-same-version
    npx electron-builder --linux deb --publish never

# Show log file location and tail recent entries
logs:
    @echo "Log file: ~/.config/Cassette/logs/main.log"
    @tail -50 ~/.config/Cassette/logs/main.log 2>/dev/null || echo "No log file yet. Run the app first."
