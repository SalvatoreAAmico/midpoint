import Foundation

public struct SupabaseConfig: Sendable {
    public var url: String
    public var key: String
    public init(url: String, key: String) { self.url = url.trimmingCharacters(in: CharacterSet(charactersIn: "/")); self.key = key }
    public var configured: Bool { !url.isEmpty && !key.isEmpty }
}

/// Filters that travel with the session so nobody ends up looking at a
/// different list. Unknown keys are ignored, missing ones leave the local
/// value alone, wrong types are skipped (`applyRemoteFilters`).
public struct Filters: Equatable, Codable, Sendable {
    public var travel: Travel = .drive
    public var when: String = ""
    public var whenTime: String = "19:00"
    public var noChains: Bool = true
    public var maxPrice: String = ""
    public init() {}

    public var json: JSONValue {
        .object(["travel": .string(travel.rawValue), "when": .string(when), "whenTime": .string(whenTime),
                 "noChains": .bool(noChains), "maxPrice": .string(maxPrice)])
    }

    /// - Returns: whether anything changed.
    @discardableResult
    public mutating func apply(remote f: JSONValue?) -> Bool {
        guard case .object(let o)? = f else { return false }
        let before = self
        if case .string(let t)? = o["travel"] { travel = t == "walk" ? .walk : .drive }
        if case .string(let w)? = o["when"] { when = w }
        if case .string(let w)? = o["whenTime"] { whenTime = w }
        if case .bool(let b)? = o["noChains"] { noChains = b }
        if case .string(let p)? = o["maxPrice"] { maxPrice = p }
        return self != before
    }
}

/// `mp_state`, decoded tolerantly: this is data other clients wrote.
public struct RemoteState: Sendable {
    public struct RemotePerson: Sendable, Equatable {
        public var id: String, name: String, label: String
        public var lat: Double?, lon: Double?
    }
    public var code: String
    public var cats: [String]
    public var filters: JSONValue?
    public var results: SharedResults?
    public var resultsBy: String?
    public var people: [RemotePerson]
    public var votes: Votes

    public static func decode(_ data: Data) throws -> RemoteState {
        guard case .object(let o) = try JSONDecoder().decode(JSONValue.self, from: data) else {
            throw SyncError.server("Unexpected session format")
        }
        let people: [RemotePerson] = (o["people"].flatMap { v -> [JSONValue]? in if case .array(let a) = v { return a } else { return nil } } ?? [])
            .compactMap { v in
                guard case .object(let p) = v, let id = p["id"]?.string else { return nil }
                return RemotePerson(id: id, name: p["name"]?.string ?? "", label: p["label"]?.string ?? "",
                                    lat: p["lat"]?.double, lon: p["lon"]?.double)
            }
        var votes: Votes = [:]
        if case .array(let vs)? = o["votes"] {
            for v in vs {
                guard case .object(let r) = v, let pid = r["participant_id"]?.string, let key = r["venue_key"]?.string,
                      let dir = r["dir"]?.double else { continue }
                votes[key, default: [:]][pid] = Int(dir)
            }
        }
        var results: SharedResults?
        if let r = o["results"], r != .null {
            // Round-trip through JSON so SharedResults' own tolerant decoder does the work.
            if let d = try? JSONEncoder().encode(r) { results = try? JSONDecoder().decode(SharedResults.self, from: d) }
        }
        var cats: [String] = []
        if case .array(let c)? = o["cats"] { cats = c.compactMap(\.string) }
        return RemoteState(code: o["code"]?.string ?? "", cats: cats, filters: o["filters"], results: results,
                           resultsBy: o["results_by"]?.string, people: people, votes: votes)
    }
}

public enum SyncError: Error, Equatable, Sendable, LocalizedError {
    case sessionNotFound, sessionFull, notConfigured
    case server(String)
    /// The project predates a migration (PostgREST 404, PGRST202).
    case missingFunction(String)

    public var errorDescription: String? { userMessage }

    /// Leads with the fix, not the failure.
    public var userMessage: String {
        switch self {
        case .sessionNotFound: return "That session has expired or does not exist."
        case .sessionFull: return "That session already has 8 people."
        case .notConfigured: return "Live sessions are not set up in this build."
        case .server(let m): return m
        case .missingFunction(let m): return m
        }
    }
}
