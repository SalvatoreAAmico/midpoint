import Foundation

public struct Venue: Codable, Hashable, Sendable {
    public var key: String           // "node/123" — also the vote key
    public var name: String
    public var kind: String
    public var lat: Double
    public var lon: Double
    public var town: String
    public var hours: String
    public var price: Int?
    public var chain: Bool
    /// Set by `filterVenues`; nil = unknown hours.
    public var open: Bool?

    public var coordinate: Coordinate { Coordinate(lat: lat, lon: lon) }

    public init(key: String, name: String, kind: String = "", lat: Double, lon: Double,
                town: String = "", hours: String = "", price: Int? = nil, chain: Bool = false, open: Bool? = nil) {
        self.key = key; self.name = name; self.kind = kind; self.lat = lat; self.lon = lon
        self.town = town; self.hours = hours; self.price = price; self.chain = chain; self.open = open
    }

    // Venues arrive from other clients' sessions as well as from Overpass:
    // unknown fields are ignored and missing ones defaulted, as the web app does.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? ""
        lat = try c.decode(Double.self, forKey: .lat)
        lon = try c.decode(Double.self, forKey: .lon)
        town = try c.decodeIfPresent(String.self, forKey: .town) ?? ""
        hours = try c.decodeIfPresent(String.self, forKey: .hours) ?? ""
        price = try? c.decodeIfPresent(Int.self, forKey: .price)
        chain = (try? c.decodeIfPresent(Bool.self, forKey: .chain)) ?? false
        open = try? c.decodeIfPresent(Bool.self, forKey: .open)
    }
}

/// One element of an Overpass `out center` response.
public struct OverpassElement: Decodable, Sendable {
    public struct Center: Decodable, Sendable { public let lat: Double?; public let lon: Double? }
    public let type: String
    public let id: Int64
    public let lat: Double?
    public let lon: Double?
    public let center: Center?
    public let tags: [String: String]?
}

public struct OverpassResponse: Decodable, Sendable { public let elements: [OverpassElement]? }

public enum Venues {
    /// Overpass elements -> venues.
    public static func parse(_ elements: [OverpassElement]?) -> [Venue] {
        (elements ?? []).compactMap { el in
            guard let lat = el.lat ?? el.center?.lat, let lon = el.lon ?? el.center?.lon else { return nil }
            let tags = el.tags ?? [:]
            guard let name = tags["name"], !name.isEmpty else { return nil }   // unnamed nodes are noise
            func first(_ keys: [String]) -> String {
                for k in keys { if let v = tags[k], !v.isEmpty { return v } }
                return ""
            }
            return Venue(
                key: "\(el.type)/\(el.id)",
                name: name,
                kind: first(["amenity", "leisure", "tourism", "shop"]),
                lat: lat, lon: lon,
                // The town is shown where OSM knows it and simply absent where
                // it does not. Reverse geocoding each result would be one
                // Nominatim call per venue, which their usage policy forbids.
                town: first(["addr:city", "addr:town", "addr:village", "addr:hamlet", "addr:suburb"]),
                hours: tags["opening_hours"] ?? "",
                price: Hours.priceLevel(tags),
                chain: Chains.isChain(tags: tags, name: name))
        }
    }

    public struct Filter: Sendable {
        public var noChains: Bool
        /// Filter to venues open at this moment. nil = don't filter by time.
        public var at: Date?
        /// "" = no cap, else "1"–"4".
        public var maxPrice: String
        public init(noChains: Bool, at: Date?, maxPrice: String) {
            self.noChains = noChains; self.at = at; self.maxPrice = maxPrice
        }
    }

    /// Chains, opening hours and price, in that order. Unknown hours and
    /// unknown price are never dropped; most of OSM has neither.
    /// `chainsHidden` is -1 when the area is chains and nothing else, so the
    /// caller can say so and show them anyway.
    public static func filter(_ venues: [Venue], _ f: Filter, now: Date = Date(),
                              calendar: Calendar = .current) -> (venues: [Venue], chainsHidden: Int) {
        var venues = venues
        var chainsHidden = 0
        if f.noChains {
            let indie = venues.filter { !$0.chain }
            chainsHidden = venues.count - indie.count
            if !indie.isEmpty { venues = indie } else if !venues.isEmpty { chainsHidden = -1 }
        }
        let moment = f.at ?? now
        for i in venues.indices { venues[i].open = Hours.isOpen(venues[i].hours, at: moment, calendar: calendar) }
        if f.at != nil { venues = venues.filter { $0.open != false } }
        if let cap = Int(f.maxPrice), !f.maxPrice.isEmpty {
            venues = venues.filter { $0.price == nil || $0.price! <= cap }
        }
        return (venues, chainsHidden)
    }

    /// Where to look, and how far. An iPhone and a laptop holding the same
    /// people must pick the same circle, or "whoever tapped Find" decides the
    /// list.
    public static func searchArea(located: [Coordinate], travel: Travel) -> (center: Coordinate, together: Bool, radius: Double) {
        let center = Geo.centroid(located)!
        let walking = travel == .walk
        let maxFromCenter = located.map { Geo.haversine($0, center) }.max() ?? 0
        // Already together: search wider, because the question is no longer
        // who travels but what is worth walking out to.
        let together = located.count > 1 && maxFromCenter < Limits.togetherM
        let floor = together ? (walking ? Limits.togetherRadiusWalk : Limits.togetherRadiusDrive)
                             : (walking ? 600 : 1500)
        let cap = walking ? Limits.maxRadiusWalk : Limits.maxRadiusDrive
        return (center, together, min(cap, max(floor, maxFromCenter * 0.45)))
    }
}

public enum Travel: String, Codable, Sendable {
    case drive, walk
    public var speed: Double {
        self == .walk ? Limits.speedWalk : Limits.speedDrive
    }
}
