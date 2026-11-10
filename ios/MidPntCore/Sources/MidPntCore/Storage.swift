import Foundation

/// Where the `midpoint.*` keys live. The names are the web app's and must not
/// change (`midpoint.session` backs resume; renaming it brings back the
/// duplicate-you-on-relaunch bug). An app cannot read Safari's storage, so
/// this is not for compatibility — it keeps the house rule one rule.
public protocol KeyValueStore: Sendable {
    func string(forKey key: String) -> String?
    func set(_ value: String?, forKey key: String)
}

public enum StoreKey {
    public static let session = "midpoint.session"
    public static let groups = "midpoint.groups"
    public static let name = "midpoint.name"
    public static let mine = "midpoint.mine"
    public static let maps = "midpoint.maps"
}

public struct UserDefaultsStore: KeyValueStore, @unchecked Sendable {
    private let defaults: UserDefaults
    public init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func string(forKey key: String) -> String? { defaults.string(forKey: key) }
    public func set(_ value: String?, forKey key: String) {
        if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

public final class MemoryStore: KeyValueStore, @unchecked Sendable {
    private let lock = NSLock()
    private var d: [String: String] = [:]
    public init() {}
    public func string(forKey key: String) -> String? { lock.withLock { d[key] } }
    public func set(_ value: String?, forKey key: String) { lock.withLock { d[key] = value } }
}

public enum GroupStore {
    /// Twelve groups, a few KB. Bad entries are dropped, not fatal: storage
    /// can hold anything.
    public static func load(_ store: KeyValueStore) -> [SavedGroup] {
        guard let s = store.string(forKey: StoreKey.groups), let data = s.data(using: .utf8),
              let list = try? JSONDecoder().decode([Lossy<SavedGroup>].self, from: data) else { return [] }
        return list.compactMap(\.value).filter { !$0.name.isEmpty }
    }
    public static func save(_ groups: [SavedGroup], to store: KeyValueStore) {
        let capped = Array(groups.prefix(SavedGroup.maxGroups))
        if let d = try? JSONEncoder().encode(capped) { store.set(String(decoding: d, as: UTF8.self), forKey: StoreKey.groups) }
    }
}

struct Lossy<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: Decoder) throws { value = try? T(from: decoder) }
}
