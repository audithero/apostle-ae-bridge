# Apostle Installer

A signed SwiftUI app that installs Apostle AE Bridge with no Terminal: live
checks, an install checklist, Claude sign-in, and the setup guide on its last
screen. It embeds one release zip and runs that release's
`scripts/install-core.sh` (the same code Install.command uses).

- Build: `installer/build.sh [release.zip]` produces `build-out/Apostle Installer.app`
  and `build-out/Apostle-Installer-<version>.dmg`. `scripts/publish-release.sh stable`
  builds it and publishes the DMG to
  https://updates.apostle.io/ae-bridge/download/Apostle-Installer.dmg (notarized only).
- Design review: `APOSTLE_SNAPSHOT=<dir> ".build/release/ApostleInstaller"` renders every
  screen to PNG.
- End-to-end test against a sandbox home (never your own setup):
  `APOSTLE_TEST_HOME=<dir> APOSTLE_TEST_IGNORE_AE=1 APOSTLE_AUTOTEST=1 APOSTLE_TEST_PATH=$HOME/.local/bin "build-out/Apostle Installer.app/Contents/MacOS/Apostle Installer"`

## Notarization (one-time setup)

Without it, macOS shows "Apple could not verify…" on every other Mac. With it,
the app opens with a normal double-click.

1. Create an app-specific password: https://account.apple.com → Sign-In and
   Security → App-Specific Passwords → "+", name it "apostle-notary".
2. In your own Terminal (it prompts for that password; nothing is echoed):

       xcrun notarytool store-credentials apostle-notary \
         --apple-id <your Apple ID email> --team-id 2K289MU28J

The build finds the `apostle-notary` profile in your Keychain and notarizes and
staples both the app and the DMG.
