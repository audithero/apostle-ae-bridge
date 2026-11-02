import SwiftUI

// Design review without a live install: APOSTLE_SNAPSHOT=<dir> renders every
// screen with sample data to PNGs (2x) and exits.
@MainActor
enum Snapshot {
    static func runIfRequested() {
        guard let dir = ProcessInfo.processInfo.environment["APOSTLE_SNAPSHOT"] else { return }
        let out = URL(fileURLWithPath: dir)
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let cases: [(String, (InstallModel) -> Void)] = [
            ("1-welcome", { m in m.screen = .welcome }),
            ("2-quit-ae", { m in m.screen = .installing; m.waitingForQuit = true }),
            ("3-installing", { m in
                m.screen = .installing
                m.steps[0].state = .done; m.steps[0].detail = "2.20.0"
                m.steps[1].state = .done; m.steps[1].detail = "Node.js 22"
                m.steps[2].state = .running; m.steps[2].detail = "Installing Claude Code…"
            }),
            ("4-failed", { m in
                m.screen = .installing
                m.steps[0].state = .done; m.steps[1].state = .fail("Couldn't download Node.js"); m.steps[1].detail = "Couldn't download Node.js"
                m.failure = "Couldn't download Node.js. Check your internet connection and try again."
            }),
            ("5-sign-in", { m in m.screen = .signIn; m.signInBusy = true }),
            ("6-ready", { m in m.screen = .ready }),
            ("7-manage", { m in m.screen = .manage; m.installedVersion = "2.20.0"; m.payloadVersion = "2.21.0" }),
        ]
        for (name, setup) in cases {
            let m = InstallModel()
            m.installedVersion = nil
            if m.afterEffects.isEmpty { m.afterEffects = ["Adobe After Effects 2026"] }
            setup(m)
            let r = ImageRenderer(content: RootView(model: m))
            r.scale = 2
            if let img = r.nsImage, let tiff = img.tiffRepresentation,
               let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                try? png.write(to: out.appendingPathComponent(name + ".png"))
            }
        }
        exit(0)
    }
}
