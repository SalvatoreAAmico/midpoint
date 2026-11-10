import Foundation
import MidPntCore

enum AppEnvironment {
    /// Shared with the widget extension so it can list saved groups.
    static let appGroup = "group.com.salvatoreaamico.midpnt"

    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }
    /// Shown in Settings → About, so "I don't see it" still has a number for an answer.
    static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0" }

    static func url(_ infoKey: String) -> URL? {
        (Bundle.main.object(forInfoDictionaryKey: infoKey) as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
    }

    /// Nominatim blocks clients that do not identify themselves, and the block
    /// would hit the web app's shared IP reputation too. A browser cannot set a
    /// User-Agent; an app must. The contact address is Sal's to choose
    /// (TODO.md) and arrives through the MP_SUPPORT_EMAIL build setting.
    static var userAgent: String {
        let email = Bundle.main.object(forInfoDictionaryKey: "MPSupportEmail") as? String ?? ""
        assert(!email.isEmpty || !isRelease, "Set MP_SUPPORT_EMAIL before shipping: Nominatim requires a contact address.")
        return "MidPnt-iOS/\(version)" + (email.isEmpty ? "" : " (\(email))")
    }
    private static var isRelease: Bool {
        #if DEBUG
        false
        #else
        true
        #endif
    }

    @MainActor
    static func makeModel() -> AppModel {
        let defaults = UserDefaults(suiteName: appGroup) ?? .standard
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        return AppModel(transport: URLSessionTransport(session: URLSession(configuration: cfg)),
                        userAgent: userAgent, supabase: Config.supabase, store: UserDefaultsStore(defaults))
    }
}
