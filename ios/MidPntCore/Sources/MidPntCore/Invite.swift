import Foundation

/// What an invite link carries. `https://salvatoreaamico.com/midpoint/?s=<code>`
/// joins a live session; with no backend the whole group travels in the `#`
/// hash. Both must keep working, because for a long time most people tapping an
/// invite will be sent here by Safari, and most links will have come from the
/// web app.
public struct Invite: Equatable, Sendable {
    public var sessionCode: String?
    public var state: LinkState?

    /// - Returns: nil when the URL is not ours or carries nothing.
    public static func parse(_ url: URL) -> Invite? {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        // Only our own path: Universal Links are claimed for /midpoint/*.
        if let host = c.host, !host.isEmpty {
            guard host.hasSuffix("salvatoreaamico.com"), c.path.hasPrefix("/midpoint") else { return nil }
        }
        // Same as `new URLSearchParams(location.search).get('s')`, trimmed and lowercased.
        let code = c.queryItems?.first(where: { $0.name == "s" })?.value?
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let hash = c.fragment ?? ""
        let state = hash.isEmpty ? nil : LinkState.parse(hash)
        let sessionCode = (code?.isEmpty == false) ? code : nil
        if sessionCode == nil && state == nil { return nil }
        return Invite(sessionCode: sessionCode, state: state)
    }

    /// The link to share for a live session.
    public static func shareURL(code: String) -> URL {
        URL(string: "https://salvatoreaamico.com/midpoint/?s=\(code)")!
    }
}
