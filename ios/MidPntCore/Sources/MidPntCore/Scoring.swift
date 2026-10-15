import Foundation

/// Someone who has shared a location, as far as scoring is concerned.
public struct Traveller: Hashable, Sendable {
    public var id: String
    public var coordinate: Coordinate
    /// Said they don't mind travelling.
    public var flex: Bool
    public init(id: String, coordinate: Coordinate, flex: Bool = false) {
        self.id = id; self.coordinate = coordinate; self.flex = flex
    }
}

public struct ScoredVenue: Hashable, Sendable {
    public var venue: Venue
    /// Seconds, by person id. A person with no entry has not shared a location
    /// and has no time of their own. Keying by id (not position) is how two
    /// index bases are made impossible rather than merely discouraged: the web
    /// app shipped that bug once.
    public var costs: [String: Double]
    public var mean: Double
    public var spread: Double
    public var score: Double
}

public enum Scoring {
    /// Lower is better. The average keeps the spot central; the spread penalty
    /// is what stops one person absorbing the whole journey.
    public static var spreadWeight: Double { Limits.spreadWeight }
    /// How much someone who volunteered still counts.
    public static var flexWeight: Double { Limits.flexWeight }

    /// Anyone who has said they don't mind travelling counts less in the
    /// average and is left out of the spread entirely. Without that, a single
    /// person far from the rest drags the whole group toward them — seven
    /// people each going an hour out of their way to save one person an hour.
    ///
    /// - Parameter matrix: `[traveller][venue]` seconds, as OSRM returns it;
    ///   nil entries drop that venue. Pass nil for straight-line estimates.
    public static func score(_ venues: [Venue], travellers: [Traveller],
                             matrix: [[Double?]]?, speed: Double) -> [ScoredVenue] {
        guard !travellers.isEmpty else { return [] }
        let w = travellers.map { $0.flex ? flexWeight : 1.0 }
        let wSum = w.reduce(0, +)
        let fixed = travellers.indices.filter { !travellers[$0].flex }

        var out: [(ScoredVenue, Int)] = []
        for (vi, v) in venues.enumerated() {
            var costs: [Double] = []
            var ok = true
            for (pi, p) in travellers.enumerated() {
                let c: Double? = matrix.map { $0[pi][vi] } ?? Geo.haversine(p.coordinate, v.coordinate) / speed
                guard let c, c.isFinite else { ok = false; break }
                costs.append(c)
            }
            if !ok { continue }

            // Same left-to-right accumulation as app.js, so the two agree to
            // the last bit rather than to a tolerance.
            var sum = 0.0
            for (i, c) in costs.enumerated() { sum += c * w[i] }
            let mean = sum / wSum
            // Spread over the people who did not volunteer. With exactly one of
            // them the spread is zero, which is correct: there is no fairness
            // to balance, only that person's journey to minimise.
            let pool = fixed.isEmpty ? costs : fixed.map { costs[$0] }
            let spread = pool.max()! - pool.min()!
            var byID: [String: Double] = [:]
            for (i, p) in travellers.enumerated() { byID[p.id] = costs[i] }
            out.append((ScoredVenue(venue: v, costs: byID, mean: mean, spread: spread,
                                    score: mean + spreadWeight * spread), vi))
        }
        // JS's sort is stable; Swift's is not guaranteed to be. Ties fall back
        // to input order so equal scores cannot reshuffle between runs.
        out.sort { $0.0.score != $1.0.score ? $0.0.score < $1.0.score : $0.1 < $1.1 }
        return out.map(\.0)
    }
}

/// A search result shared through a session, as the web app writes it. Costs
/// are indexed by `people` — the ids that were located when someone tapped
/// Find — NOT by whoever is on this device's roster.
public struct SharedResults: Codable, Sendable {
    public var at: Double?
    public var people: [String]
    public var together: Bool
    public var estimated: Bool
    public var travel: String?
    public var venues: [SharedVenue]

    public init(at: Double?, people: [String], together: Bool, estimated: Bool, travel: String?, venues: [SharedVenue]) {
        self.at = at; self.people = people; self.together = together; self.estimated = estimated
        self.travel = travel; self.venues = venues
    }

    public struct SharedVenue: Codable, Sendable {
        public var venue: Venue
        public var costs: [Double?]
        public init(venue: Venue, costs: [Double?]) { self.venue = venue; self.costs = costs }
        public init(from decoder: Decoder) throws {
            venue = try Venue(from: decoder)
            costs = try decoder.container(keyedBy: Keys.self).decodeIfPresent([Double?].self, forKey: .costs) ?? []
        }
        public func encode(to encoder: Encoder) throws {
            try venue.encode(to: encoder)
            var c = encoder.container(keyedBy: Keys.self)
            try c.encode(costs, forKey: .costs)
        }
        enum Keys: String, CodingKey { case costs }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = try? c.decodeIfPresent(Double.self, forKey: .at)
        people = try c.decodeIfPresent([String].self, forKey: .people) ?? []
        together = (try? c.decodeIfPresent(Bool.self, forKey: .together)) ?? false
        estimated = (try? c.decodeIfPresent(Bool.self, forKey: .estimated)) ?? false
        travel = try? c.decodeIfPresent(String.self, forKey: .travel)
        venues = try c.decodeIfPresent([SharedVenue].self, forKey: .venues) ?? []
    }

    /// Re-index onto this device's roster by id. Anyone on the roster who was
    /// not in the search (they joined afterwards) gets no entry, and the mean
    /// and spread are recomputed over the people who do have a time.
    public func remapped(onto roster: [String]) -> [ScoredVenue] {
        var seat: [String: Int] = [:]
        for (i, id) in people.enumerated() where seat[id] == nil { seat[id] = i }   // JS Map keeps the last; ids are unique in practice
        return venues.compactMap { sv in
            var costs: [String: Double] = [:]
            for id in roster {
                if let i = seat[id], i < sv.costs.count, let c = sv.costs[i] { costs[id] = c }
            }
            if costs.isEmpty { return nil }
            // Same order as the roster, as app.js sums.
            let known = roster.compactMap { costs[$0] }
            let mean = known.reduce(0, +) / Double(known.count)
            let spread = known.max()! - known.min()!
            return ScoredVenue(venue: sv.venue, costs: costs, mean: mean, spread: spread, score: mean + Scoring.spreadWeight * spread)
        }
    }
}
