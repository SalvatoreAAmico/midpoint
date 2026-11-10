import Foundation

public struct Category: Codable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let tags: [String]
    public let syn: String
    public let chip: Bool
    public let lucky: Bool
    public let cuisine: Bool
    /// "HH:MM" for Breakfast / Lunch / Dinner — choosing a meal chooses a time.
    public let meal: String?
}

/// The constants as app.js declares them, exported by test/golden.mjs. Nothing
/// in the library reads these: the Swift values live in `Limits` as literals,
/// and `LimitsTests` fails when the two differ. That is the point — a changed
/// SPREAD_WEIGHT must turn this build red, not be followed silently.
public struct Constants: Codable, Sendable {
    public struct ByMode: Codable, Sendable { public let drive: Double; public let walk: Double }
    public let maxPeople: Int
    public let maxVenues: Int
    public let speed: ByMode
    public let maxRadius: ByMode
    public let togetherM: Double
    public let togetherRadius: ByMode
    public let spreadWeight: Double
    public let flexWeight: Double
    public let luckyCats: Int
    public let luckyPool: Int
}

/// Everything in here is generated from app.js by `node test/golden.mjs --write`
/// into Resources/catalog.json. Never edit that file by hand; edit CATALOG in
/// app.js (and read docs/osm-categories.md first).
public final class Catalog: Sendable {
    private struct File: Decodable {
        struct Chain: Decodable { let source: String; let flags: String }
        struct Names: Decodable { let adjectives: [String]; let animals: [String] }
        let constants: Constants
        let chainNames: Chain
        let codenames: Names
        let categories: [Category]
    }

    public static let shared = Catalog()

    public let constants: Constants
    public let categories: [Category]
    public let chipIDs: [String]
    public let chainNames: NSRegularExpression
    let adjectives: [String]
    let animals: [String]
    private let byID: [String: Category]

    private init() {
        guard let url = Bundle.module.url(forResource: "catalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let f = try? JSONDecoder().decode(File.self, from: data),
              let re = try? NSRegularExpression(pattern: f.chainNames.source,
                                                options: f.chainNames.flags.contains("i") ? [.caseInsensitive] : [])
        else { fatalError("catalog.json is missing or malformed — run node test/golden.mjs --write") }
        constants = f.constants
        categories = f.categories
        chipIDs = f.categories.filter(\.chip).map(\.id)
        chainNames = re
        adjectives = f.codenames.adjectives
        animals = f.codenames.animals
        byID = Dictionary(uniqueKeysWithValues: f.categories.map { ($0.id, $0) })
    }

    public subscript(id: String) -> Category? { byID[id] }

    /// Match on what people type. Every word of the query must appear somewhere
    /// in the label or synonyms, so "mini golf" narrows rather than widening.
    public func search(_ q: String) -> [Category] {
        let words = q.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard let first = words.first else { return [] }
        var hits: [(c: Category, rank: Int, order: Int)] = []
        for (i, c) in categories.enumerated() {
            let hay = (c.label + " " + c.syn).lowercased()
            guard words.allSatisfy({ hay.contains($0) }) else { continue }
            // Prefer a label match, then a synonym starting with the query.
            let rank = c.label.lowercased().contains(first) ? 0 : hay.hasPrefix(first) ? 1 : 2
            hits.append((c, rank, i))
        }
        // Array.sort is stable in JS and not guaranteed to be in Swift, so
        // ties fall back to catalogue order rather than to chance.
        hits.sort {
            if $0.rank != $1.rank { return $0.rank < $1.rank }
            let l = Catalog.localeCompare($0.c.label, $1.c.label)
            return l != 0 ? l < 0 : $0.order < $1.order
        }
        return hits.prefix(8).map(\.c)
    }

    /// JS `localeCompare` with no arguments.
    static func localeCompare(_ a: String, _ b: String) -> Int {
        switch a.compare(b, options: [], range: nil, locale: Locale(identifier: "en")) {
        case .orderedAscending: return -1
        case .orderedSame: return 0
        case .orderedDescending: return 1
        }
    }
}
