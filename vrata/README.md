# Release downloads and macOS installation

`release.mjs` generates each release description from the verified installer
feeds. The download table links directly to the release's macOS DMG, Linux
AppImage, and Windows EXE, with an architecture shown for each installer.

On macOS, open the DMG and drag **Vrata BB.app** to **Applications**. After
installation, run this command in Terminal, then open the app:

```sh
xattr -d com.apple.quarantine "/Applications/Vrata BB.app"
```

This removes the quarantine attribute from the unsigned app. The same steps
are included in every release description.
