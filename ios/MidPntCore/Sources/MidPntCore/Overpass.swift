import Foundation

public enum Overpass {
    public static let hosts = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]

    /// "amenity=restaurant&cuisine~pizza" -> ["amenity"="restaurant"]["cuisine"~"pizza",i]
    /// `=` is exact, `~` is a case-insensitive regex, which is what cuisine
    /// needs since it is often a semicolon-separated list. `!=` and `!~` negate:
    /// some categories are defined as much by what they are NOT (a breakfast
    /// cafe, but not a pizza place). In Overpass a `!~` also matches elements
    /// with the key absent, so an untagged cafe still passes.
    public static func tagFilter(_ spec: String) -> String {
        spec.split(separator: "&", omittingEmptySubsequences: false).map { part -> String in
            // ^([^=~!]+)(!?[=~])(.+)$
            guard let kEnd = part.firstIndex(where: { "=~!".contains($0) }), kEnd > part.startIndex else { return "" }
            let k = part[part.startIndex..<kEnd]
            var i = kEnd
            let neg = part[i] == "!"
            if neg { i = part.index(after: i) }
            guard i < part.endIndex, part[i] == "=" || part[i] == "~" else { return "" }
            let op = part[i]
            let v = part[part.index(after: i)...]
            guard !v.isEmpty else { return "" }
            switch (neg, op) {
            case (false, "="): return "[\"\(k)\"=\"\(v)\"]"
            case (true, "="):  return "[\"\(k)\"!=\"\(v)\"]"
            case (false, _):   return "[\"\(k)\"~\"\(v)\",i]"
            case (true, _):    return "[\"\(k)\"!~\"\(v)\",i]"
            }
        }.joined()
    }

    /// One query for every selected category, ORed. A search is two HTTP calls
    /// whatever the group size; this is the first of them.
    public static func query(center: Coordinate, radius: Double, cats: [String]) -> String {
        let at = "(around:\(Int(Geo.jsRound(radius))),\(String(format: "%.5f", center.lat)),\(String(format: "%.5f", center.lon)));"
        var sel: [String] = []
        for c in cats {
            for t in Catalog.shared[c]?.tags ?? [] { sel.append("nwr" + tagFilter(t) + at) }
        }
        return "[out:json][timeout:25];(\(sel.joined()));out center 120;"
    }
}
