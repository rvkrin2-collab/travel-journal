#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/apps/chinese-study
UPDATER=/usr/local/bin/chinese-study-update
BASE=https://raw.githubusercontent.com/rvkrin2-collab/travel-journal/main

mkdir -p "$APP_DIR"

cat >"$UPDATER" <<'UPDATER_EOF'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/opt/apps/chinese-study
BASE=https://raw.githubusercontent.com/rvkrin2-collab/travel-journal/main
MANIFEST_URL="$BASE/deploy/chinese-study/manifest.txt"

read -r VERSION COUNT EXPECTED_SHA < <(curl -fsSL --retry 3 "$MANIFEST_URL")
[[ "$VERSION" =~ ^v[0-9A-Za-z._-]+$ ]]
[[ "$COUNT" =~ ^[0-9]+$ ]]
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]]

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
: > "$TMP/site.b64"
for ((i=0; i<COUNT; i++)); do
  PART=$(printf '%02d' "$i")
  curl -fsSL --retry 3 "$BASE/tmp/chinese-study-$VERSION/$PART.txt" >> "$TMP/site.b64"
done
base64 -d "$TMP/site.b64" | gzip -d > "$TMP/index.html"
ACTUAL_SHA=$(sha256sum "$TMP/index.html" | awk '{print $1}')
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || { echo "checksum mismatch" >&2; exit 1; }

CURRENT_SHA=""
[[ -f "$APP_DIR/index.html" ]] && CURRENT_SHA=$(sha256sum "$APP_DIR/index.html" | awk '{print $1}')
if [[ "$CURRENT_SHA" != "$ACTUAL_SHA" ]]; then
  install -m 0644 "$TMP/index.html" "$APP_DIR/index.html"
  printf '%s\n' "$VERSION" > "$APP_DIR/.version"
  echo "Chinese Study updated to $VERSION"
else
  echo "Chinese Study already at $VERSION"
fi
UPDATER_EOF
chmod 0755 "$UPDATER"

cat >/etc/systemd/system/chinese-study-update.service <<EOF
[Unit]
Description=Update Chinese Study website from GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$UPDATER
EOF

cat >/etc/systemd/system/chinese-study-update.timer <<'EOF'
[Unit]
Description=Check Chinese Study website updates

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
"$UPDATER"
systemctl enable --now chinese-study-update.timer

printf '\nInstalled. Current version: '
cat "$APP_DIR/.version" 2>/dev/null || echo unknown
printf 'Timer: '
systemctl is-active chinese-study-update.timer
printf 'Local site: '
curl -fsSI http://127.0.0.1:8910/ | head -n1 || true
