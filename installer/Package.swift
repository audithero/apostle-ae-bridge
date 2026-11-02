// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ApostleInstaller",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "ApostleInstaller", path: "Sources/ApostleInstaller")
    ]
)
