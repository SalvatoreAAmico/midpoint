import SwiftUI

/// docs/design-system.md §3. Fraunces for display only, the system font for
/// everything you read, JetBrains Mono for every number.
enum Typo {
    static let display = Font.custom("Fraunces", size: 34, relativeTo: .largeTitle).weight(.medium)
    static let title = Font.custom("Fraunces", size: 21, relativeTo: .title2).weight(.medium)
    static let heading = Font.system(size: 16, weight: .semibold)
    static let body = Font.system(size: 15)
    static let label = Font.system(size: 13, weight: .medium)
    static let micro = Font.system(size: 11, weight: .semibold)
    static func data(_ size: CGFloat = 13) -> Font { .custom("JetBrains Mono", size: size, relativeTo: .footnote).weight(.medium) }
}

extension View {
    /// Section header: 11pt, uppercase, letter-spaced. The only place tracking is used.
    func microHeader() -> some View { font(Typo.micro).textCase(.uppercase).tracking(0.9).foregroundStyle(Palette.muted) }
}
