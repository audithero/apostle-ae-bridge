import SwiftUI

// House style from the Apostle panel: near-black, Helvetica Neue, a widely
// tracked wordmark, editorial numbering, thin rules, one green for "good".

enum Theme {
    static let bg = Color(red: 0.043, green: 0.043, blue: 0.043)
    static let surface = Color(red: 0.078, green: 0.078, blue: 0.078)
    static let line = Color(red: 0.149, green: 0.149, blue: 0.149)
    static let text = Color(red: 0.949, green: 0.949, blue: 0.941)
    static let dim = Color(red: 0.541, green: 0.541, blue: 0.525)
    static let ok = Color(red: 0.490, green: 0.847, blue: 0.490)
    static let warn = Color(red: 0.910, green: 0.757, blue: 0.353)
    static let err = Color(red: 0.878, green: 0.376, blue: 0.376)

    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "HelveticaNeue-Bold"
        case .semibold, .medium: name = "HelveticaNeue-Medium"
        case .light: name = "HelveticaNeue-Light"
        default: name = "HelveticaNeue"
        }
        return .custom(name, size: size)
    }
    static let spring = Animation.spring(response: 0.4, dampingFraction: 1)
}

// MARK: - root

struct RootView: View {
    @StateObject private var model: InstallModel
    init(model: InstallModel? = nil) { _model = StateObject(wrappedValue: model ?? InstallModel()) }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            Masthead(screen: model.screen)
            ZStack {
                switch model.screen {
                case .welcome: WelcomeView().transition(forward)
                case .installing: InstallingView().transition(forward)
                case .signIn: SignInView().transition(forward)
                case .ready: ReadyView().transition(forward)
                case .manage: ManageView().transition(forward)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, 48)
            .padding(.top, 34)
            ProgressRail(screen: model.screen)
        }
        .environmentObject(model)
        .background(Theme.bg)
        .foregroundStyle(Theme.text)
        .frame(width: 780, height: 580)
        .preferredColorScheme(.dark)
    }

    // forward motion enters from the right and leaves to the left (spatial
    // consistency); Reduce Motion gets a plain cross-fade
    private var forward: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(
            insertion: .opacity.combined(with: .offset(x: 28)),
            removal: .opacity.combined(with: .offset(x: -28)))
    }
}

struct Masthead: View {
    let screen: Screen
    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                HStack(alignment: .top, spacing: 2) {
                    Text("APOSTLE").font(Theme.font(17, .bold)).tracking(17 * 0.34)
                    Text("®").font(Theme.font(8)).padding(.top, 1)
                }
                Spacer()
                Text(label).font(Theme.font(10)).tracking(1.2).foregroundStyle(Theme.dim)
                    .contentTransition(.opacity)
            }
            .padding(.horizontal, 28)
            .padding(.top, 34) // clear of the traffic lights
            .padding(.bottom, 14)
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }
    private var label: String {
        switch screen {
        case .welcome: return "NO. /01  INSTALL"
        case .installing: return "NO. /01  INSTALLING"
        case .signIn: return "NO. /02  SIGN IN"
        case .ready: return "NO. /03  READY"
        case .manage: return "INSTALLED"
        }
    }
}

struct ProgressRail: View {
    let screen: Screen
    private var lit: Int {
        switch screen {
        case .welcome: return 0
        case .installing: return 1
        case .signIn: return 2
        case .ready, .manage: return 3
        }
    }
    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<3) { i in
                Capsule().fill(i < lit ? Theme.text : Theme.line).frame(height: 2)
            }
        }
        .animation(Theme.spring, value: lit)
        .padding(.horizontal, 28)
        .padding(.bottom, 22)
        .padding(.top, 10)
    }
}

// MARK: - shared bits

struct Headline: View {
    let text: String
    let sub: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(text).font(Theme.font(40, .medium)).tracking(-0.8).lineSpacing(-2)
                .fixedSize(horizontal: false, vertical: true)
            Text(sub).font(Theme.font(14)).foregroundStyle(Theme.dim).lineSpacing(3)
                .frame(maxWidth: 520, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct PrimaryButton: View {
    let title: String
    var enabled = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(Theme.font(14, .medium)).tracking(0.3)
                .padding(.horizontal, 26).padding(.vertical, 12)
                .foregroundStyle(enabled ? Theme.bg : Theme.dim)
                .background(Capsule().fill(enabled ? Theme.text : Theme.line))
        }
        .buttonStyle(PressStyle())
        .disabled(!enabled)
        .keyboardShortcut(.defaultAction)
    }
}

struct SecondaryButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(Theme.font(14, .medium)).tracking(0.3)
                .padding(.horizontal, 22).padding(.vertical, 11)
                .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(PressStyle())
    }
}

struct LinkButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(Theme.font(12)).foregroundStyle(Theme.dim).underline(true, color: Theme.line)
        }.buttonStyle(PressStyle())
    }
}

// feedback on press, not on release
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

struct StatusDot: View {
    let state: StepState
    @State private var spin = false
    var body: some View {
        ZStack {
            switch state {
            case .pending:
                Circle().stroke(Theme.line, lineWidth: 1.5)
            case .running:
                Circle().trim(from: 0, to: 0.7).stroke(Theme.text, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .rotationEffect(.degrees(spin ? 360 : 0))
                    .onAppear { withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { spin = true } }
            case .done:
                Circle().fill(Theme.ok)
                Image(systemName: "checkmark").font(.system(size: 8, weight: .heavy)).foregroundStyle(Theme.bg)
            case .warn:
                Circle().fill(Theme.warn)
                Text("!").font(Theme.font(10, .bold)).foregroundStyle(Theme.bg)
            case .fail:
                Circle().fill(Theme.err)
                Image(systemName: "xmark").font(.system(size: 7, weight: .heavy)).foregroundStyle(Theme.bg)
            }
        }
        .frame(width: 16, height: 16)
        .transition(.scale(scale: 0.6).combined(with: .opacity))
    }
}

struct Row: View {
    let state: StepState
    let title: String
    let detail: String
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            StatusDot(state: state).alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
            Text(title).font(Theme.font(14, state == .pending ? .regular : .medium))
                .foregroundStyle(state == .pending ? Theme.dim : Theme.text)
            Spacer(minLength: 12)
            Text(detail).font(Theme.font(12)).foregroundStyle(detailColor)
                .lineLimit(1).truncationMode(.middle)
        }
        .padding(.vertical, 11)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }
    private var detailColor: Color {
        switch state {
        case .warn: return Theme.warn
        case .fail: return Theme.err
        default: return Theme.dim
        }
    }
}

// MARK: - 01 welcome

struct WelcomeView: View {
    @EnvironmentObject var model: InstallModel
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Headline(text: "Claude, inside\nAfter Effects.",
                     sub: "Describe a shot, a title or a whole explainer, and Claude builds it in your open project. This sets everything up in about a minute.")
            VStack(spacing: 0) {
                Row(state: model.newestAfterEffects == nil ? .fail("") : .done,
                    title: model.newestAfterEffects ?? "After Effects 2024 or newer",
                    detail: model.newestAfterEffects == nil ? "Install it from Creative Cloud first" : "Found")
                Row(state: .pending, title: "Claude account", detail: "You'll sign in after installing (Pro or Max)")
            }
            .padding(.top, 30)
            Spacer()
            HStack(alignment: .center, spacing: 18) {
                PrimaryButton(title: "Install", enabled: model.newestAfterEffects != nil) { model.startInstall() }
                Text("Installs to your Applications folder. No password needed.")
                    .font(Theme.font(12)).foregroundStyle(Theme.dim)
            }
            .padding(.bottom, 26)
        }
    }
}

// MARK: - installing

struct InstallingView: View {
    @EnvironmentObject var model: InstallModel
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Headline(text: model.failure == nil ? "Setting up." : "Something went wrong.",
                     sub: model.failure ?? "This takes about a minute. You can watch it tick off.")
            if model.waitingForQuit {
                QuitCard().padding(.top, 24)
                    .transition(.opacity.combined(with: .offset(y: 8)))
            }
            VStack(spacing: 0) {
                ForEach(model.steps) { s in Row(state: s.state, title: s.title, detail: s.detail) }
            }
            .padding(.top, model.waitingForQuit ? 14 : 26)
            .opacity(model.waitingForQuit ? 0.45 : 1)
            Spacer()
            if model.failure != nil {
                HStack(spacing: 14) {
                    PrimaryButton(title: "Try again") { model.startInstall() }
                    SecondaryButton(title: "Copy details") { model.copyLog() }
                }.padding(.bottom, 26)
            }
        }
        .animation(Theme.spring, value: model.waitingForQuit)
    }
}

struct QuitCard: View {
    @EnvironmentObject var model: InstallModel
    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("After Effects is open").font(Theme.font(14, .medium))
                Text("It needs to close so the panel can be added. It will offer to save your work first.")
                    .font(Theme.font(12)).foregroundStyle(Theme.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            SecondaryButton(title: "Quit After Effects") { model.quitAfterEffects() }
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.warn.opacity(0.5), lineWidth: 1))
    }
}

// MARK: - 02 sign in

struct SignInView: View {
    @EnvironmentObject var model: InstallModel
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Headline(text: "Sign in to Claude.",
                     sub: "Apostle works through Claude Code on your Claude plan. Your browser opens to sign in; come back here when it says you're done.")
            VStack(spacing: 0) {
                Row(state: model.signedInAs != nil ? .done : (model.signInBusy ? .running : .pending),
                    title: model.signedInAs.map { "Signed in as \($0)" } ?? "Claude account",
                    detail: model.signInBusy ? "Waiting for your browser…" : "")
            }.padding(.top, 30)
            if let e = model.signInError {
                Text(e).font(Theme.font(12)).foregroundStyle(Theme.err).padding(.top, 12)
            }
            Spacer()
            HStack(alignment: .center, spacing: 18) {
                PrimaryButton(title: model.signInBusy ? "Waiting…" : "Sign in with Claude", enabled: !model.signInBusy) { model.signIn() }
                LinkButton(title: "Use an Anthropic Console account instead") { model.signIn(console: true) }
            }.padding(.bottom, 26)
        }
    }
}

// MARK: - 03 ready: the guide lives here

struct ReadyView: View {
    @EnvironmentObject var model: InstallModel
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Headline(text: "You're set.", sub: "Three things to do in After Effects, once.")
            HStack(alignment: .top, spacing: 12) {
                GuideCard(number: "01", title: "Open the panel") {
                    MenuPath(items: ["Window", "Extensions", "Apostle"])
                    Text("Dock it anywhere. After Effects remembers it.").guideNote()
                }
                GuideCard(number: "02", title: "Check the link") {
                    MiniMasthead()
                    Text("Green means Claude can reach After Effects.").guideNote()
                }
                GuideCard(number: "03", title: "Ask Claude") {
                    Text("“\(firstPrompt)”").font(Theme.font(12)).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                    Button { model.copyFirstPrompt() } label: {
                        Text(model.copied ? "COPIED" : "COPY").font(Theme.font(10, .medium)).tracking(1)
                            .foregroundStyle(model.copied ? Theme.ok : Theme.dim)
                    }.buttonStyle(PressStyle())
                    Text("Use the panel's CLAUDE tab, or Open Claude below.").guideNote()
                }
            }
            .fixedSize(horizontal: false, vertical: true) // all three as tall as the tallest, no taller
            .padding(.top, 26)
            Spacer()
            HStack(alignment: .center, spacing: 14) {
                PrimaryButton(title: "Open After Effects") { model.openAfterEffects() }
                SecondaryButton(title: "Open Claude") { model.openClaude() }
                Spacer()
                Text("Updates arrive in the panel.").font(Theme.font(12)).foregroundStyle(Theme.dim)
            }.padding(.bottom, 26)
        }
    }
}

struct GuideCard<Content: View>: View {
    let number: String
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("NO. /\(number)").font(Theme.font(10)).tracking(1.2).foregroundStyle(Theme.dim)
            Text(title).font(Theme.font(16, .medium)).tracking(-0.2)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

extension Text {
    func guideNote() -> some View {
        self.font(Theme.font(11)).foregroundStyle(Theme.dim).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
    }
}

struct MenuPath: View {
    let items: [String]
    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                Text(item).font(Theme.font(10.5, .medium)).lineLimit(1).fixedSize()
                    .padding(.horizontal, 6).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Theme.line))
                if i < items.count - 1 {
                    Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold)).foregroundStyle(Theme.dim)
                }
            }
        }
    }
}

// a little copy of the panel's masthead, so they know what to look for
struct MiniMasthead: View {
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("APOSTLE").font(Theme.font(10, .bold)).tracking(3.4)
            Spacer()
            HStack(spacing: 5) {
                Circle().fill(Theme.ok).frame(width: 5, height: 5)
                Text("claude linked").font(Theme.font(10)).foregroundStyle(Theme.ok)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Theme.bg))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

// MARK: - already installed

struct ManageView: View {
    @EnvironmentObject var model: InstallModel
    @State private var confirmUninstall = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if model.uninstalled {
                Headline(text: "Uninstalled.",
                         sub: "The panel and Claude's connection are removed. The Apostle folder, with any briefs and builds, is in the Trash if you need it back.")
            } else {
                Headline(text: "Apostle is installed.",
                         sub: model.updateAvailable
                            ? "Version \(model.installedVersion ?? "?") is installed. This installer has \(model.payloadVersion)."
                            : "Version \(model.installedVersion ?? "?"). Updates also arrive in the Apostle panel by themselves.")
                Spacer()
                HStack(alignment: .center, spacing: 14) {
                    PrimaryButton(title: model.updateAvailable ? "Update to \(model.payloadVersion)" : "Repair") { model.startInstall() }
                    SecondaryButton(title: "Setup guide") { withAnimation(Theme.spring) { model.screen = .ready } }
                    Spacer()
                    LinkButton(title: "Uninstall") { confirmUninstall = true }
                }.padding(.bottom, 26)
            }
        }
        .confirmationDialog("Uninstall Apostle?", isPresented: $confirmUninstall) {
            Button("Uninstall", role: .destructive) { model.uninstall() }
        } message: {
            Text("This removes the panel and Claude's connection, and moves the Apostle folder (with your briefs and builds) to the Trash.")
        }
    }
}
