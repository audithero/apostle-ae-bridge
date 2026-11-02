import SwiftUI

@main
struct ApostleInstallerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .commands { CommandGroup(replacing: .newItem) {} }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated { Snapshot.runIfRequested() }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.windows.first?.center()
    }
}
