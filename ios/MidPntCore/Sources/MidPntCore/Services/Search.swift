import Foundation

public struct SearchOutcome: Sendable {
    public var results: [ScoredVenue]
    public var center: Coordinate
    public var together: Bool
    /// Straight-line stand-ins for the routing service. Every figure shown from
    /// such a result must be marked "~" so an estimate never reads as measured.
    public var estimated: Bool
    /// -1: the area is chains and nothing else, shown anyway.
    public var chainsHidden: Int
    /// True when filters removed every venue ("No matching spots nearby").
    public var empty: Bool { results.isEmpty }
}

public enum Search {
    /// A search is two HTTP calls whatever the group size: one Overpass query,
    /// one OSRM `/table`. (A failed Overpass host retries on its mirror; a
    /// failed OSRM degrades to estimates rather than failing the search.) If a
    /// change makes this per-person or per-venue, it is the wrong change.
    public static func run(located: [Traveller], cats: [String], travel: Travel, filter: Venues.Filter,
                           overpass: OverpassClient, osrm: OSRM) async throws -> SearchOutcome {
        precondition(!located.isEmpty, "Add at least one location first.")
        let area = Venues.searchArea(located: located.map(\.coordinate), travel: travel)
        let fetched = try await overpass.venues(center: area.center, radius: area.radius, cats: cats)
        let filtered = Venues.filter(fetched, filter)
        if filtered.venues.isEmpty {
            return SearchOutcome(results: [], center: area.center, together: area.together,
                                 estimated: false, chainsHidden: filtered.chainsHidden)
        }
        // Pre-trim by straight-line fairness so the matrix call stays small.
        let trimmed = Scoring.score(filtered.venues, travellers: located, matrix: nil, speed: travel.speed)
            .prefix(Limits.maxVenues).map(\.venue)

        var matrix: [[Double?]]?
        do {
            matrix = try await osrm.durations(from: located.map(\.coordinate), to: trimmed.map(\.coordinate),
                                              profile: .init(travel))
        } catch { matrix = nil }

        return SearchOutcome(
            results: Scoring.score(trimmed, travellers: located, matrix: matrix, speed: travel.speed),
            center: area.center, together: area.together, estimated: matrix == nil,
            chainsHidden: filtered.chainsHidden)
    }
}
