import Foundation

public enum Names {
    /// Placeholder names, so a session is not four rows of "Me". Deterministic
    /// from the participant id: every device derives the same name for the same
    /// person with no coordination, and it survives a reload.
    public static func codename(_ id: String) -> String {
        let cat = Catalog.shared
        var h: UInt32 = 0
        // JS: `for (const ch of String(id)) ... ch.charCodeAt(0)`. The loop walks
        // code points but charCodeAt(0) reads only the first UTF-16 unit of
        // each, so an astral character (an emoji) contributes its HIGH
        // SURROGATE and nothing else. Hashing the whole UTF-16 string would
        // disagree with the web app on exactly those ids; the golden vectors
        // include one.
        for scalar in id.unicodeScalars {
            let v = scalar.value
            let unit = v > 0xFFFF ? 0xD800 + ((v - 0x10000) >> 10) : v
            // h * 31 in doubles is exact below 2^53, and `>>> 0` is arithmetic
            // mod 2^32 — the same as wrapping UInt32 arithmetic.
            h = h &* 31 &+ unit
        }
        return cat.adjectives[Int(h) % cat.adjectives.count] + " "
             + cat.animals[Int(h >> 8) % cat.animals.count]
    }

    /// Nominatim's address fields, rendered the way people actually name
    /// places: the specific part, then the wider one it sits in. County is
    /// skipped — few people say "Worcester County" — and the wider part is
    /// dropped when it merely repeats the specific one.
    public static func placeName(_ addr: [String: String]?, displayName: String = "") -> String {
        let a = addr ?? [:]
        func get(_ k: String) -> String? { a[k].flatMap { $0.isEmpty ? nil : $0 } }
        let local = ["neighbourhood", "suburb", "quarter", "city_district", "village", "town", "city", "municipality"]
            .lazy.compactMap(get).first
        let wider = ["city", "town", "state"].lazy.compactMap(get)
            .first { $0.lowercased() != (local ?? "").lowercased() }
        let out = [local, wider].compactMap { $0 }.joined(separator: ", ")
        if !out.isEmpty { return out }
        return displayName.split(separator: ",", omittingEmptySubsequences: false)
            .prefix(2).joined(separator: ",").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A name you would recognise in a list, from the people in it.
    public static func suggestGroupName(_ people: [Person]) -> String {
        let names = people.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if names.isEmpty { return "" }
        if names.count <= 3 { return names.joined(separator: ", ") }
        return "\(names[0]), \(names[1]) +\(names.count - 2)"
    }
}

/// Fisher-Yates. Not `sort { random }`, which biases badly and varies by engine.
public func shuffled<T, R: RandomNumberGenerator>(_ arr: [T], using g: inout R) -> [T] {
    var a = arr
    guard a.count > 1 else { return a }
    for i in stride(from: a.count - 1, to: 0, by: -1) {
        let j = Int.random(in: 0...i, using: &g)
        a.swapAt(i, j)
    }
    return a
}
