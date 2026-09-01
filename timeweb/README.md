# OwnTravel on Timeweb

The public journal remains on GitHub Pages. Timeweb serves only
`api.owntravel.ru`.

`owntravel-api` terminates HTTPS. Media requests are handled by
`owntravel-media`, which keeps an immutable local copy after the first successful
fetch from the existing Worker. Author commands continue to use the Worker as a
fallback until its credentials and R2 data have been migrated.

This split is intentional: changing the API cannot take public pages offline,
and the media cache can be removed without changing any published page.

`install.sh` refuses to change the VPS while the root domain still resolves to
the Timeweb address. It keeps the previous Caddy and Compose files under
`/opt/apps/owntravel/backups`, validates the API and verifies a real cached
photograph after deployment.
