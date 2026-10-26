# Vrata distribution overlay

Keep distribution changes in `vrata/` and Vrata workflows. Preserve upstream
BB source files and tests in Git so new BB releases can be merged without
maintaining a fork of their update logic.

`node vrata/prepare.mjs` applies the overlay to a disposable build checkout.
Every source replacement checks its expected match count before any source
file is written. An upstream change that invalidates an anchor stops preparation.

## Desktop revisions

`distribution.json` supplies the upstream version and `releaseRevision`.
Revision zero keeps the upstream version; later builds use `-rN`. The desktop
package, installers, feeds, and release tag use that same version.

`desktop-version.ts` compares revisions numerically:
`0.47.1 < 0.47.1-r1 < 0.47.1-r2 < 0.47.1-r10 < 0.47.2`.
The native updater retains OS and rollout checks and rejects actual downgrades.
Other prerelease formats keep their SemVer ordering.

The update overlay uses seven checked substitutions in four upstream source
files: feed comparison, native updater configuration, the sidebar availability
condition, and the existing desktop update service's version argument. Passing
the known build version keeps upstream restart-result handling unchanged.
The helper and dedicated regression tests are copied into the build checkout.
The revision overlay leaves upstream test files unchanged.

The sidebar reports availability before download, including on unsigned macOS
builds that require manual installation. Old builds whose embedded versions
are all `0.47.1` need one manual upgrade to a build containing this overlay.

Run `node --test vrata/*.test.mjs` before preparation. The Vrata Desktop workflow
runs the copied behavioral regressions and upstream updater tests after applying
the overlay, then packages and smoke-tests the installers.
