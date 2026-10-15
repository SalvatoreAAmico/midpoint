import Foundation

/// `{ venueKey: { personID: 1 | -1 } }`, as the web app holds it.
public typealias Votes = [String: [String: Int]]

public enum VoteBook {
    public static func tally(_ votes: Votes, _ key: String) -> (up: Int, down: Int) {
        var up = 0, down = 0
        for v in votes[key]?.values ?? [:].values { v > 0 ? (up += 1) : (down += 1) }
        return (up, down)
    }

    /// A thumbs-down rules a place out only while nobody wants it. One objection
    /// is enough to drop a place no one is arguing for; once someone has said
    /// yes the place stays, carrying its no, and the group talks.
    public static func isVetoed(_ votes: Votes, _ key: String) -> Bool {
        let t = tally(votes, key); return t.down > 0 && t.up == 0
    }

    /// Anyone objecting is still enough to stop the app declaring a winner.
    public static func isContested(_ votes: Votes, _ key: String) -> Bool { tally(votes, key).down > 0 }

    /// Once everyone with a location has voted, the group has decided.
    public static func winner(votes: Votes, people: [Person], results: [ScoredVenue]) -> ScoredVenue? {
        var voters = Set<String>()
        for v in votes.values { voters.formUnion(v.keys) }
        let present = people.filter { $0.lat != nil }
        guard present.count >= 2, present.allSatisfy({ voters.contains($0.id) }) else { return nil }
        let live = results.filter { !isContested(votes, $0.venue.key) && tally(votes, $0.venue.key).up > 0 }
        guard var best = live.first else { return nil }
        for v in live.dropFirst() where tally(votes, v.venue.key).up > tally(votes, best.venue.key).up { best = v }
        return best
    }

    /// Tapping your current vote again retracts it. Returns the direction now
    /// held (0 = none), which is what `mp_vote` is sent.
    @discardableResult
    public static func toggle(_ votes: inout Votes, key: String, me: String, dir: Int) -> Int {
        var v = votes[key] ?? [:]
        if v[me] == dir { v[me] = nil } else { v[me] = dir }
        votes[key] = v.isEmpty ? nil : v
        return v[me] ?? 0
    }
}

public enum Maps {
    public enum App: String, Codable, Sendable, CaseIterable { case apple, google, osm }

    static func enc(_ s: String) -> String { URLEncoding.encode(s) }

    /// Fixed strings, not interpolated doubles: JS prints 41.9 as "41.9" and so does Swift,
    /// but both print 0 as "0", and the golden vectors hold that.
    public static func url(name: String, lat: Double, lon: Double, app: App) -> String {
        let q = enc(name)
        func n(_ d: Double) -> String { d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : String(d) }
        let ll = "\(n(lat)),\(n(lon))"
        switch app {
        case .apple: return "https://maps.apple.com/?q=\(q)&ll=\(ll)"
        case .osm:   return "https://www.openstreetmap.org/?mlat=\(n(lat))&mlon=\(n(lon))#map=18/\(n(lat))/\(n(lon))"
        case .google: return "https://www.google.com/maps/search/?api=1&query=\(ll)&query_place_id=&query=\(q)%20\(ll)"
        }
    }
}

public enum Lucky {
    /// Pick a few activity types at random. Never re-rolls into the identical
    /// set — a re-roll that changes nothing reads as a broken button.
    public static func roll<R: RandomNumberGenerator>(current: [String], wasLucky: Bool, using g: inout R) -> [String] {
        let keys = Catalog.shared.categories.filter(\.lucky).map(\.id)
        let n = Limits.luckyCats
        let next = Array(shuffled(keys, using: &g).prefix(n))
        if wasLucky && next.allSatisfy(current.contains) {
            return Array(shuffled(keys.filter { !current.contains($0) }, using: &g).prefix(n))
        }
        return next
    }

    /// Shuffle within the fairest handful rather than across everything: a
    /// "random" pick that is 40 minutes from one person defeats the point.
    public static func shuffleFairest<R: RandomNumberGenerator>(_ results: [ScoredVenue], using g: inout R) -> [ScoredVenue] {
        let pool = Array(results.prefix(Limits.luckyPool))
        return shuffled(pool, using: &g) + Array(results.dropFirst(Limits.luckyPool))
    }
}
