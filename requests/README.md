# Private trip requests

Trip request JSON files can contain shared-album URLs. Keep them out of Git: `*.json` is ignored in this directory. Process a local request with `npm run trip:new -- --request <path>` and commit only the generated, redacted public files.
