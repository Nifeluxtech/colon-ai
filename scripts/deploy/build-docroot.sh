#!/bin/sh
# Builds one app's web document root exactly as the cPanel deploy does (.cpanel.yml runs this script).
#
#   sh scripts/deploy/build-docroot.sh <repo dir> <app: chat|browser|admin> <docroot dir>
#
# Layout it produces (version read from the root package.json, the one place it is set):
#   <docroot>/index.html, assets/...          apps/<app>/public/.   (the page and its own CSS/config)
#   <docroot>/v<version>/apps/<app>/src/...   the app's ES modules
#   <docroot>/v<version>/packages/ui/{js,css,fonts}/...
#   <docroot>/v<version>/packages/brand/{css,js,assets}/...
#   <docroot>/ui/fonts/... and <docroot>/brand/...   unversioned mirrors kept for URLs from older releases
#                     (/ui/fonts/*.woff2, /brand/colon-intro.css|js); /brand also gets the brand marks.
# The versioned folder is copied first and swapped in whole; index.html is copied last, so a page never
# points at files that are not there yet. Older v<version> folders are left in place (rollback, cached
# pages). Nothing is deleted outside v<version>, and .htaccess (server-only, gitignored) is never written.
# POSIX sh and coreutils only: cPanel runs deploy tasks without a terminal and node may not be on PATH.
set -eu

REPO=${1:?usage: build-docroot.sh <repo dir> <app> <docroot dir>}
APP=${2:?usage: build-docroot.sh <repo dir> <app> <docroot dir>}
DOC=${3:?usage: build-docroot.sh <repo dir> <app> <docroot dir>}

case "$APP" in chat|browser|admin) ;; *) echo "build-docroot: unknown app '$APP'" >&2; exit 1 ;; esac

VERSION=$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' "$REPO/package.json" | head -n 1)
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "build-docroot: no version in $REPO/package.json" >&2; exit 1 ;;
esac

PUBLIC="$REPO/apps/$APP/public"
if [ -e "$PUBLIC/.htaccess" ]; then
  echo "build-docroot: $PUBLIC/.htaccess must not be in the repo (it lives only on the server)" >&2; exit 1
fi

mkdir -p "$DOC"

# 1. Versioned modules and shared assets, built beside the live folder and then swapped in.
V="$DOC/v$VERSION"
TMP="$DOC/.v$VERSION.tmp"
rm -rf "$TMP"
mkdir -p "$TMP/apps/$APP" "$TMP/packages/ui" "$TMP/packages/brand"
cp -R "$REPO/apps/$APP/src" "$TMP/apps/$APP/src"
for d in js css fonts; do cp -R "$REPO/packages/ui/$d" "$TMP/packages/ui/$d"; done
for d in css js assets; do cp -R "$REPO/packages/brand/$d" "$TMP/packages/brand/$d"; done
rm -rf "$V"
mv "$TMP" "$V"

# 2. Backward-compatible mirrors: the /brand and /ui URLs earlier releases used. The old classic scripts
#    and stylesheets under /ui (colon-app.js, colon-ui.css, ...) are not rewritten; files from earlier
#    deploys stay where they are, as cp never deletes.
mkdir -p "$DOC/brand" "$DOC/ui/fonts"
for d in css js assets; do cp -R "$REPO/packages/brand/$d/." "$DOC/brand/"; done
cp -R "$REPO/packages/ui/fonts/." "$DOC/ui/fonts/"

# 3. The page itself, last.
cp -R "$PUBLIC/." "$DOC/"

echo "build-docroot: $APP v$VERSION -> $DOC"
