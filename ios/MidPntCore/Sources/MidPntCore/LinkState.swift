import Foundation

public struct Person: Hashable, Sendable, Codable {
    public var id: String
    public var name: String
    public var lat: Double?
    public var lon: Double?
    public var label: String
    public var flex: Bool
    /// Name was a placeholder (`Names.codename`), not something typed. Local only.
    public var nameAuto: Bool = false
    /// A location lookup is in flight. Local only.
    public var locating: Bool = false
    public init(id: String, name: String = "", lat: Double? = nil, lon: Double? = nil, label: String = "", flex: Bool = false,
                nameAuto: Bool = false, locating: Bool = false) {
        self.id = id; self.name = name; self.lat = lat; self.lon = lon; self.label = label; self.flex = flex
        self.nameAuto = nameAuto; self.locating = locating
    }
    public var coordinate: Coordinate? {
        guard let lat, let lon else { return nil }
        return Coordinate(lat: lat, lon: lon)
    }
}

/// What a no-backend invite link carries in its `#` hash. The defaults for
/// every missing field live in `parse`, exactly as in app.js `parseState`.
public struct LinkState: Equatable, Sendable {
    public var people: [Person]
    public var cats: [String]
    public var when: String
    public var whenTime: String
    public var travel: Travel
    public var maxPrice: String
    public var lucky: Bool
    public var noChains: Bool
    public var votes: [String: [String: Int]]
    public var hashMe: String?

    /// nil when the hash is not decodable at all — the web app then starts blank.
    public static func parse(_ hash: String) -> LinkState? {
        // atob() accepts unpadded base64; Data(base64Encoded:) does not.
        var b64 = hash.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b64.removeAll(where: { $0 == "=" || $0.isWhitespace })
        if b64.count % 4 == 1 { return nil }
        b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
        // decodeURIComponent(escape(...)) is a strict UTF-8 decode.
        guard let data = Data(base64Encoded: b64), let text = String(data: data, encoding: .utf8),
              let json = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
        else { return nil }

        let d: [String: JSONValue]
        switch json {
        case .null: return nil                        // `d.p` on null throws
        case .object(let o): d = o
        default: d = [:]                              // valid JSON, no fields: all defaults
        }

        var people: [Person] = []
        if case .array(let rows)? = d["p"] {
            for row in rows.prefix(Limits.maxPeople) {
                guard case .array(let a) = row else { return nil }
                func at(_ i: Int) -> JSONValue { i < a.count ? a[i] : .null }
                people.append(Person(
                    id: at(0).jsString == "null" ? "" : at(0).jsString,
                    name: at(1).truthy ? at(1).jsString : "",
                    lat: at(2).double, lon: at(3).double,
                    label: at(4).truthy ? at(4).jsString : "",
                    flex: at(5).truthy))
            }
        }

        var cats = ["coffee"]
        if case .array(let c)? = d["c"], !c.isEmpty { cats = c.compactMap(\.string) }

        let when: String
        if let w = d["w"] { when = w.jsString }
        else { when = (d["o"]?.truthy ?? false) ? "now" : "" }      // `o`: links made before the when control

        var votes: [String: [String: Int]] = [:]
        if case .object(let v)? = d["v"] {
            for (venue, byPerson) in v {
                guard case .object(let m) = byPerson else { continue }
                votes[venue] = m.compactMapValues { $0.double.map(Int.init) }
            }
        }

        let price: String
        if let r = d["r"], r.truthy { price = r.jsString } else { price = "" }

        return LinkState(
            people: people,
            cats: cats,
            when: when,
            whenTime: (d["wt"]?.truthy ?? false) ? d["wt"]!.jsString : "19:00",
            travel: d["tv"]?.string == "walk" ? .walk : .drive,
            maxPrice: price,
            lucky: d["l"]?.truthy ?? false,
            // Absent in links made before this filter existed; default it on.
            noChains: d["n"].map(\.truthy) ?? true,
            votes: votes,
            hashMe: d["m"]?.string)
    }
}
