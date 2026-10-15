import Foundation

/// A saved group ("the Tuesday crew"). Deliberately local: no account, no
/// backend, no permission. Stored under the `midpoint.groups` key (see
/// docs/ios-plan.md §6) so the house rule about those names stays one rule.
public struct SavedGroup: Codable, Hashable, Sendable {
    public struct Member: Codable, Hashable, Sendable {
        public var name: String
        public var label: String
        public var lat: Double?
        public var lon: Double?
        public var flex: Bool
        public init(name: String, label: String, lat: Double?, lon: Double?, flex: Bool) {
            self.name = name; self.label = label; self.lat = lat; self.lon = lon; self.flex = flex
        }
    }
    public var id: String
    public var name: String
    public var people: [Member]

    public static let maxGroups = 12

    /// Only what is worth restoring. Ids are regenerated on load so a group can
    /// be loaded twice, or into a session that already has people.
    public static func from(name: String, people: [Person], autoNamed: Set<String> = [],
                            id: String = UUID().uuidString) -> SavedGroup {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return SavedGroup(
            id: id,
            name: String(trimmed.prefix(40)),
            people: people
                .filter { !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || $0.lat != nil }
                .map { Member(name: autoNamed.contains($0.id) ? "" : $0.name, label: $0.label,
                              lat: $0.lat, lon: $0.lon, flex: $0.flex) }
                .prefix(Limits.maxPeople).map { $0 })
    }
}
