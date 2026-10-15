// swift-tools-version: 6.0
import PackageDescription

// No UIKit, SwiftUI, MapKit or CoreLocation in here, so this builds and tests
// on Linux (`swift test`). Coordinates are plain lat/lon; the app target adapts
// CLLocation at its edge. See docs/ios-plan.md §2.
let package = Package(
    name: "MidPntCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "MidPntCore", targets: ["MidPntCore"])],
    targets: [
        .target(
            name: "MidPntCore",
            resources: [.copy("Resources/catalog.json")]
        ),
        .testTarget(name: "MidPntCoreTests", dependencies: ["MidPntCore"]),
    ]
)
