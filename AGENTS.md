# Repository agent instructions

These instructions apply to all work in this repository, including unattended Symphony runs.

## Scope and safety

- Work only inside the provided repository workspace.
- Treat the GitHub issue as the scope boundary. Do not bundle unrelated cleanup into its pull request.
- Never publish to the Chrome Web Store, Firefox Add-ons, or any deployment target.
- Never force-push, change repository settings, create releases, publish, deploy, or expose secrets.
- Never merge manually. Native auto-merge is permitted only when the linked issue explicitly has `gakucho-automerge` and both Gakucho governor stages declare the exact PR head eligible.
- Do not edit generated `dist/` or `web-ext-artifacts/` output directly. Change source files and regenerate packages with the documented scripts.
- Preserve existing user changes and avoid destructive Git operations.

## Development workflow

- The default branch is `master`. Codex Cloud is the default issue runner; local Symphony remains available for Mac-specific work and creates an isolated `symphony/gh-<number>` branch from `origin/master`.
- Read the issue, this file, `README.md`, and the relevant parts of `TESTING.md` before changing code.
- Reproduce the requested behavior or establish a failing test before implementation when practical.
- Prefer the smallest focused change that fully satisfies the issue and add regression coverage at the lowest useful test layer.
- Use `npm run check` as the minimum pre-commit gate. Also run the most relevant targeted test while iterating.
- Run `npm run verify:packages` when manifests, packaged runtime files, or packaging scripts change.
- Run `npm run smoke:chrome` when route injection, packaged-browser behavior, YouTube Watch/Music lifecycle, or rendered compact-player interaction changes.
- Run `npm run build` for release-facing or broadly cross-cutting changes.
- Do not claim manual browser validation unless it was actually performed.

## Git and handoff

- Stage only files that belong to the issue.
- Write comprehensive commit messages that describe all material changes, rationale, and validation. Longer commit messages are welcome when they improve the record.
- Push the prepared issue branch and open a pull request against `master` with `Closes #<issue-number>` in its body.
- Leave substantive or unauthorized work in human-review state. Low-risk work may use native auto-merge only under the explicit issue authorization and repository-governor policy above.
