import AppKit
import Foundation
import SwiftUI

// Everything the installer does, as one state machine the views render.
// The real install work is scripts/install-core.sh from the bundled release
// (shared with Install.command); this drives it and reads its @@ progress lines.

enum Screen: Equatable { case welcome, installing, signIn, ready, manage }

enum StepState: Equatable { case pending, running, done, warn(String), fail(String) }

struct Step: Identifiable, Equatable {
    let id: String
    let title: String
    var detail: String = ""
    var state: StepState = .pending
}

// APOSTLE_TEST_HOME points the whole install at a sandbox home (tests only)
let testEnv = ProcessInfo.processInfo.environment
let userHome = testEnv["APOSTLE_TEST_HOME"].map { URL(fileURLWithPath: $0) }
    ?? FileManager.default.homeDirectoryForCurrentUser
let installDir = userHome.appendingPathComponent("Applications/Apostle AE Bridge")
let firstPrompt = "Build the demo film in briefs/demo, then show me a frame from the middle of it."

@MainActor
final class InstallModel: ObservableObject {
    @Published var screen: Screen = .welcome
    @Published var steps: [Step] = InstallModel.freshSteps()
    @Published var afterEffects: [String] = []          // e.g. ["Adobe After Effects 2026"]
    @Published var installedVersion: String?
    @Published var payloadVersion: String = "?"
    @Published var aeRunning = false
    @Published var waitingForQuit = false
    @Published var failure: String?
    @Published var signInBusy = false
    @Published var signedInAs: String?
    @Published var signInError: String?
    @Published var copied = false
    @Published var uninstalled = false
    private var log = ""
    private var aeTimer: Timer?

    static func freshSteps() -> [Step] {
        [
            Step(id: "files", title: "Copying Apostle"),
            Step(id: "node", title: "Setting up Node.js"),
            Step(id: "claude", title: "Claude Code"),
            Step(id: "panel", title: "Adding the Apostle panel"),
            Step(id: "prefs", title: "Allowing frame previews"),
            Step(id: "connect", title: "Connecting Claude to After Effects"),
        ]
    }

    init() {
        refresh()
        payloadVersion = Self.readPayloadVersion() ?? "?"
        screen = installedVersion == nil ? .welcome : .manage
        if testEnv["APOSTLE_AUTOTEST"] != nil { autotest() }
        aeTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.pollAfterEffects() }
        }
    }

    // MARK: detection

    func refresh() {
        let apps = (try? FileManager.default.contentsOfDirectory(atPath: "/Applications")) ?? []
        afterEffects = apps.filter { name in
            guard name.hasPrefix("Adobe After Effects 20"), let year = Int(name.suffix(4)) else { return false }
            return year >= 2024
        }.sorted(by: >)
        installedVersion = Self.readVersion(at: installDir.appendingPathComponent("release.json"))
        pollAfterEffects()
    }

    func pollAfterEffects() {
        aeRunning = testEnv["APOSTLE_TEST_IGNORE_AE"] == nil && NSWorkspace.shared.runningApplications.contains {
            ($0.bundleIdentifier ?? "").hasPrefix("com.adobe.AfterEffects")
        }
        if waitingForQuit && !aeRunning {
            waitingForQuit = false
            runInstall()
        }
    }

    var newestAfterEffects: String? { afterEffects.first }

    var updateAvailable: Bool {
        guard let inst = installedVersion else { return false }
        return inst.compare(payloadVersion, options: .numeric) == .orderedAscending
    }

    static func readVersion(at url: URL) -> String? {
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj["version"] as? String
    }

    static func readPayloadVersion() -> String? {
        guard let url = Bundle.main.url(forResource: "payload", withExtension: "json") else { return nil }
        return readVersion(at: url)
    }

    // MARK: install

    func startInstall() {
        failure = nil
        steps = Self.freshSteps()
        withAnimation(.spring(response: 0.4, dampingFraction: 1)) { screen = .installing }
        if aeRunning { waitingForQuit = true } else { runInstall() }
    }

    func quitAfterEffects() {
        for app in NSWorkspace.shared.runningApplications
        where (app.bundleIdentifier ?? "").hasPrefix("com.adobe.AfterEffects") {
            app.terminate() // After Effects asks to save anything unsaved
        }
    }

    private func runInstall() {
        log = ""
        guard let zip = Bundle.main.url(forResource: "payload", withExtension: "zip") else {
            failure = "This installer is missing its files. Download it again."
            return
        }
        let staging = userHome.appendingPathComponent("Library/Caches/Apostle AE Bridge/installer")
        try? FileManager.default.removeItem(at: staging)
        try? FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        setStep("files", .running)

        let unzip = Process()
        unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        unzip.arguments = ["-x", "-k", zip.path, staging.path]
        unzip.terminationHandler = { [weak self] p in
            Task { @MainActor in
                guard let self else { return }
                if p.terminationStatus != 0 { self.fail("files", "Couldn't unpack the installer's files."); return }
                self.runCore(payload: staging.appendingPathComponent("Apostle AE Bridge"))
            }
        }
        do { try unzip.run() } catch { fail("files", error.localizedDescription) }
    }

    private func runCore(payload: URL) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [payload.appendingPathComponent("scripts/install-core.sh").path, payload.path]
        p.environment = Self.shellEnvironment()
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        var buffer = ""
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let chunk = String(decoding: h.availableData, as: UTF8.self)
            Task { @MainActor in
                guard let self else { return }
                buffer += chunk
                while let nl = buffer.firstIndex(of: "\n") {
                    let line = String(buffer[..<nl])
                    buffer = String(buffer[buffer.index(after: nl)...])
                    self.handle(line)
                }
            }
        }
        err.fileHandleForReading.readabilityHandler = { [weak self] h in
            let chunk = String(decoding: h.availableData, as: UTF8.self)
            Task { @MainActor in self?.log += chunk }
        }
        p.terminationHandler = { [weak self] proc in
            Task { @MainActor in
                out.fileHandleForReading.readabilityHandler = nil
                err.fileHandleForReading.readabilityHandler = nil
                guard let self else { return }
                if proc.terminationStatus != 0 && self.failure == nil {
                    self.failure = "Setup stopped unexpectedly."
                }
            }
        }
        do { try p.run() } catch { fail("files", error.localizedDescription) }
    }

    // @@step <id> <running|done|warn|fail> <message> · @@done <version> · @@fail <id> <message>
    private func handle(_ line: String) {
        log += line + "\n"
        let parts = line.split(separator: " ", maxSplits: 3, omittingEmptySubsequences: false).map(String.init)
        guard let tag = parts.first else { return }
        switch tag {
        case "@@step" where parts.count >= 3:
            let msg = parts.count > 3 ? parts[3] : ""
            switch parts[2] {
            case "running": setStep(parts[1], .running, msg)
            case "done": setStep(parts[1], .done, msg)
            case "warn": setStep(parts[1], .warn(msg), msg)
            case "fail": setStep(parts[1], .fail(msg), msg)
            default: break
            }
        case "@@done":
            installedVersion = parts.count > 1 ? parts[1] : payloadVersion
            writeOpenClaudeCommand()
            Task { await self.afterInstall() }
        case "@@fail" where parts.count >= 2:
            fail(parts[1], parts.count > 2 ? parts[2...].joined(separator: " ") : "Setup failed.")
        default: break
        }
    }

    // APOSTLE_AUTOTEST: press Install, print each step change, exit 0 when the
    // install reaches sign-in or ready, 1 on failure (tests only)
    private func autotest() {
        startInstall()
        Task {
            var last = ""
            for _ in 0..<600 {
                try? await Task.sleep(nanoseconds: 250_000_000)
                let now = steps.map { "\($0.id)=\($0.state)" }.joined(separator: " ")
                if now != last { print(now); last = now }
                if let f = failure { print("FAILED: \(f)"); exit(1) }
                if screen == .signIn || screen == .ready { print("SCREEN: \(screen)"); exit(0) }
            }
            print("TIMEOUT"); exit(1)
        }
    }

    private func setStep(_ id: String, _ state: StepState, _ detail: String = "") {
        guard let i = steps.firstIndex(where: { $0.id == id }) else { return }
        withAnimation(.spring(response: 0.35, dampingFraction: 1)) {
            steps[i].state = state
            if !detail.isEmpty { steps[i].detail = detail }
        }
    }

    private func fail(_ id: String, _ message: String) {
        setStep(id, .fail(message), message)
        failure = message
    }

    private func afterInstall() async {
        try? await Task.sleep(nanoseconds: 600_000_000) // let the last tick land
        if let who = await Self.claudeSignedIn() {
            signedInAs = who
            withAnimation(.spring(response: 0.4, dampingFraction: 1)) { screen = .ready }
        } else {
            withAnimation(.spring(response: 0.4, dampingFraction: 1)) { screen = .signIn }
        }
    }

    func copyLog() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(log, forType: .string)
    }

    // MARK: Claude sign-in

    static func claudePath() -> String? {
        let home = userHome.path
        for c in ["\(home)/.local/bin/claude", "\(home)/.claude/local/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
        where FileManager.default.isExecutableFile(atPath: c) { return c }
        return nil
    }

    static func shellEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let home = userHome.path
        env["HOME"] = home
        env["PATH"] = (testEnv["APOSTLE_TEST_PATH"].map { $0 + ":" } ?? "")
            + "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        return env
    }

    /// The signed-in account's email (or a placeholder), or nil when not signed in.
    static func claudeSignedIn() async -> String? {
        guard let claude = claudePath() else { return nil }
        return await withCheckedContinuation { cont in
            let p = Process()
            p.executableURL = URL(fileURLWithPath: claude)
            p.arguments = ["auth", "status", "--json"]
            p.environment = shellEnvironment()
            let out = Pipe()
            p.standardOutput = out
            p.standardError = Pipe()
            p.terminationHandler = { _ in
                let data = out.fileHandleForReading.readDataToEndOfFile()
                let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                if obj?["loggedIn"] as? Bool == true {
                    cont.resume(returning: (obj?["email"] as? String) ?? "your Claude account")
                } else {
                    cont.resume(returning: nil)
                }
            }
            do { try p.run() } catch { cont.resume(returning: nil) }
        }
    }

    func signIn(console: Bool = false) {
        guard let claude = Self.claudePath() else { signInError = "Claude Code isn't installed. Run setup again."; return }
        signInError = nil
        signInBusy = true
        let p = Process()
        p.executableURL = URL(fileURLWithPath: claude)
        p.arguments = ["auth", "login", console ? "--console" : "--claudeai"]
        p.environment = Self.shellEnvironment()
        p.standardOutput = Pipe()
        p.standardError = Pipe()
        try? p.run()
        Task {
            for _ in 0..<300 { // up to 10 minutes
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if let who = await Self.claudeSignedIn() {
                    signedInAs = who
                    signInBusy = false
                    if p.isRunning { p.terminate() }
                    try? await Task.sleep(nanoseconds: 700_000_000)
                    withAnimation(.spring(response: 0.4, dampingFraction: 1)) { screen = .ready }
                    return
                }
                if !p.isRunning && p.terminationStatus != 0 { break }
            }
            signInBusy = false
            signInError = "Sign-in didn't finish. Try again."
        }
    }

    // MARK: ready actions

    func openAfterEffects() {
        guard let name = newestAfterEffects else { return }
        let dir = URL(fileURLWithPath: "/Applications/\(name)")
        let app = dir.appendingPathComponent("\(name).app")
        NSWorkspace.shared.openApplication(at: app, configuration: NSWorkspace.OpenConfiguration())
    }

    private var openClaudeURL: URL { installDir.appendingPathComponent("Open Claude.command") }

    private func writeOpenClaudeCommand() {
        let script = """
        #!/bin/bash
        # Opens Claude Code in the Apostle folder (its instructions and tools live here).
        export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
        cd "$HOME/Applications/Apostle AE Bridge" && clear && exec claude
        """
        try? script.write(to: openClaudeURL, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: openClaudeURL.path)
    }

    func openClaude() {
        if !FileManager.default.fileExists(atPath: openClaudeURL.path) { writeOpenClaudeCommand() }
        NSWorkspace.shared.open(openClaudeURL)
    }

    func copyFirstPrompt() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(firstPrompt, forType: .string)
        withAnimation(.spring(response: 0.3, dampingFraction: 1)) { copied = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            withAnimation(.spring(response: 0.3, dampingFraction: 1)) { copied = false }
        }
    }

    // MARK: uninstall

    /// Removes the panel and the Claude connection, and moves the install folder
    /// to the Trash (recoverable), never deleting it outright.
    func uninstall() {
        if let claude = Self.claudePath() {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: claude)
            p.arguments = ["mcp", "remove", "-s", "user", "AfterEffectsMCP"]
            p.environment = Self.shellEnvironment()
            p.standardOutput = Pipe(); p.standardError = Pipe()
            try? p.run(); p.waitUntilExit()
        }
        let cep = userHome.appendingPathComponent("Library/Application Support/Adobe/CEP/extensions/apostle-panel")
        try? FileManager.default.removeItem(at: cep)
        NSWorkspace.shared.recycle([installDir]) { _, _ in
            Task { @MainActor in
                self.installedVersion = nil
                withAnimation(.spring(response: 0.4, dampingFraction: 1)) { self.uninstalled = true }
            }
        }
    }
}
