import Foundation

/// A subset of OSM `opening_hours`: "24/7", "Mo-Fr 08:00-18:00",
/// "Mo-Sa 09:00-22:00; Su 10:00-16:00". Anything it can't parse is `nil` =
/// "unknown", and unknowns are never filtered out — most of OSM has no hours.
public enum Hours {
    static let days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

    // Same pattern as app.js, including /i. Note that matching is
    // case-insensitive but the day lookup below is not: "mo-fr 08:00-18:00"
    // parses and then names no day we know, which reads as closed. That quirk
    // is pinned by a golden vector so both clients keep it.
    private static let dayName = "(?:Mo|Tu|We|Th|Fr|Sa|Su)"
    private static let rule = try! NSRegularExpression(
        pattern: "^((?:(?:\(dayName))(?:-(?:\(dayName)))?)(?:,(?:\(dayName))(?:-(?:\(dayName)))?)*)?\\s*(.*)$",
        options: [.caseInsensitive])
    private static let span = try! NSRegularExpression(
        pattern: "^(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})$")

    /// - Parameters:
    ///   - day: 0 = Sunday … 6 = Saturday, as JS `getDay()`.
    ///   - minutes: minutes since local midnight.
    public static func isOpen(_ spec: String?, day today: Int, minutes mins: Int) -> Bool? {
        guard let spec, !spec.isEmpty else { return nil }
        let s = spec.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.caseInsensitiveCompare("24/7") == .orderedSame { return true }

        var parsedAny = false      // any rule we understood, on any day
        var coversToday = false    // ...and at least one of them applies to today

        for raw in s.split(separator: ";", omittingEmptySubsequences: false) {
            let r = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let ns = r as NSString
            guard let m = rule.firstMatch(in: r, range: NSRange(location: 0, length: ns.length)) else { continue }
            let dayPart: String? = m.range(at: 1).location == NSNotFound ? nil : ns.substring(with: m.range(at: 1))
            let timePart = m.range(at: 2).location == NSNotFound ? "" : ns.substring(with: m.range(at: 2))
            if timePart.isEmpty { continue }

            // Which days does this rule cover? No day prefix = every day.
            var covers = (dayPart == nil || dayPart == "")
            if let dayPart, !dayPart.isEmpty {
                for grp in dayPart.split(separator: ",", omittingEmptySubsequences: false) {
                    let ends = grp.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
                    guard let ia = days.firstIndex(of: ends[0]) else { continue }
                    let ib = ends.count > 1 ? days.firstIndex(of: ends[1]) : ia
                    guard let ib else { continue }
                    // inclusive range that may wrap (e.g. Sa-Su)
                    var i = ia
                    while true {
                        if i == today { covers = true }
                        if i == ib { break }
                        i = (i + 1) % 7
                    }
                }
            }
            let lower = timePart.lowercased()
            if lower.hasPrefix("off") || lower.contains("closed") { parsedAny = true; continue }

            for sp in timePart.split(separator: ",", omittingEmptySubsequences: false) {
                let t = sp.trimmingCharacters(in: .whitespacesAndNewlines)
                let tn = t as NSString
                guard let tm = span.firstMatch(in: t, range: NSRange(location: 0, length: tn.length)) else { continue }
                func n(_ i: Int) -> Int { Int(tn.substring(with: tm.range(at: i)))! }
                parsedAny = true                       // we understood this rule
                if !covers { continue }                // ...but it isn't today's
                coversToday = true
                let from = n(1) * 60 + n(2)
                var to = n(3) * 60 + n(4)
                if to <= from { to += 1440 }           // closes after midnight
                if mins >= from && mins < to { return true }
                if mins + 1440 >= from && mins + 1440 < to { return true }
            }
        }
        // A spec we understood that names no open window for right now means
        // closed — including days it simply doesn't mention.
        return (parsedAny || coversToday) ? false : nil
    }

    public static func isOpen(_ spec: String?, at date: Date, calendar: Calendar = .current) -> Bool? {
        let c = calendar.dateComponents([.weekday, .hour, .minute], from: date)
        return isOpen(spec, day: (c.weekday ?? 1) - 1, minutes: (c.hour ?? 0) * 60 + (c.minute ?? 0))
    }

    /// OSM price data is sparse. Read it where it exists; never guess, never
    /// exclude a venue just because the tag is missing.
    public static func priceLevel(_ tags: [String: String]) -> Int? {
        func nonEmpty(_ k: String) -> String? { tags[k].flatMap { $0.isEmpty ? nil : $0 } }
        guard let raw = nonEmpty("price:range") ?? nonEmpty("price_range") ?? nonEmpty("price") else { return nil }
        // /\${1,4}/ — the first run of dollar signs, capped at four.
        if let first = raw.firstIndex(of: "$") {
            var n = 0
            var i = first
            while i < raw.endIndex, raw[i] == "$", n < 4 { n += 1; i = raw.index(after: i) }
            return n
        }
        // parseInt(raw, 10): leading whitespace, optional sign, leading digits.
        var chars = Substring(raw).drop(while: { $0.isWhitespace })
        var sign = 1
        if let f = chars.first, f == "+" || f == "-" { if f == "-" { sign = -1 }; chars = chars.dropFirst() }
        let digits = chars.prefix(while: { $0.isASCII && $0.isNumber })
        guard let v = Int(digits) else { return nil }
        let n = sign * v
        return (1...4).contains(n) ? n : nil
    }

    /// "<1 min" / "12 min" / "—".
    public static func fmtMin(_ s: Double?) -> String {
        guard let s else { return "—" }
        return s < 60 ? "<1 min" : "\(Int(Geo.jsRound(s / 60))) min"
    }
}
