import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import MidPntCore

/// One fake internet: Supabase (the `mp_*` semantics of supabase/schema.sql,
/// in memory), Overpass, OSRM and Nominatim. Two `AppModel`s sharing one `World`
/// are two phones in one session.
final class World: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    struct P { var id: String; var name: String; var label: String; var lat: Double?; var lon: Double?; var at: Int }
    struct S { var code: String; var people: [P] = []; var cats: JSONValue = .array([.string("coffee")]); var filters: JSONValue = .object([:])
               var results: JSONValue?; var resultsBy: String?; var votes: [String: [String: Int]] = [:] }
    private var sessions: [String: S] = [:]
    private var counter = 0
    private(set) var log: [String] = []              // "host/function"
    var failSupabase = false
    var hasLabelColumn = true                         // false = project predates fix-002
    var hasResultsFunction = true                     // false = predates fix-003
    var routingDown = false
    struct V { var name: String; var lat: Double; var lon: Double; var tags: [String: String] }
    var venues: [V] = World.defaultVenues()
    static func defaultVenues() -> [V] {
        var out: [V] = []
        for i in 0..<14 {
            let lat: Double = 41.86 + Double(i) * 0.004
            let lon: Double = -87.66 + Double(i % 5) * 0.006
            out.append(V(name: "Place \(i)", lat: lat, lon: lon, tags: ["amenity": "cafe"]))
        }
        return out
    }

    static let supabase = SupabaseConfig(url: "https://fake.supabase.test", key: "anon-key")

    func count(_ needle: String) -> Int { lock.withLock { log.filter { $0.contains(needle) }.count } }
    func session(_ code: String) -> S? { lock.withLock { sessions[code] } }

    var latencyNs: UInt64 = 0
    func send(_ request: URLRequest) async throws -> (data: Data, status: Int) {
        if latencyNs > 0 { try await Task.sleep(nanoseconds: latencyNs) }
        return lock.withLock { handle(request) }
    }

    private func handle(_ request: URLRequest) -> (data: Data, status: Int) {
        let host = request.url!.host!
        let fn = request.url!.lastPathComponent
        log.append(host == "fake.supabase.test" ? "supabase/\(fn)" : host)
        switch host {
        case "fake.supabase.test": return rpc(fn, request)
        case "overpass-api.de": return overpass()
        case "router.project-osrm.org": return osrm(request.url!)
        case "nominatim.openstreetmap.org": return nominatim(request.url!)
        default: return (Data(), 404)
        }
    }

    private func err(_ m: String, _ status: Int = 400) -> (Data, Int) { (Data(#"{"message":"\#(m)"}"#.utf8), status) }
    private func json(_ v: JSONValue) -> (Data, Int) { ((try? JSONEncoder().encode(v)) ?? Data(), 200) }

    private func rpc(_ fn: String, _ r: URLRequest) -> (Data, Int) {
        if failSupabase { return err("boom", 503) }
        guard r.value(forHTTPHeaderField: "apikey") == "anon-key", r.value(forHTTPHeaderField: "Authorization") == "Bearer anon-key" else { return err("no key", 401) }
        guard case .object(let a)? = try? JSONDecoder().decode(JSONValue.self, from: r.httpBody ?? Data()) else { return err("bad body") }
        if (fn == "mp_results" && !hasResultsFunction) { return err("Could not find the function public.mp_results in the schema cache PGRST202", 404) }
        if !hasLabelColumn && a["p_label"] != nil { return err("Could not find the function public.\(fn)(p_label) PGRST202", 404) }
        func s(_ k: String) -> String { a[k]?.string ?? "" }
        func code() -> String? { let c = s("p_code").lowercased(); return sessions[c] != nil ? c : nil }
        switch fn {
        case "mp_create":
            counter += 1
            let c = String(format: "%010x", counter * 7919)
            let pid = "00000000-0000-0000-0000-\(String(format: "%012d", counter))"
            sessions[c] = S(code: c, people: [P(id: pid, name: s("p_name"), label: s("p_label"), lat: a["p_lat"]?.double, lon: a["p_lon"]?.double, at: counter)])
            return json(.object(["code": .string(c), "participant_id": .string(pid)]))
        case "mp_join":
            guard let c = code() else { return err("session_not_found") }
            if sessions[c]!.people.count >= 8 { return err("session_full") }
            counter += 1
            let pid = "00000000-0000-0000-0000-\(String(format: "%012d", counter))"
            sessions[c]!.people.append(P(id: pid, name: s("p_name"), label: s("p_label"), lat: a["p_lat"]?.double, lon: a["p_lon"]?.double, at: counter))
            return json(.object(["participant_id": .string(pid)]))
        case "mp_state":
            guard let c = code() else { return err("session_not_found") }
            let x = sessions[c]!
            return json(.object([
                "code": .string(c), "cats": x.cats, "filters": x.filters, "results": x.results ?? .null,
                "results_by": x.resultsBy.map(JSONValue.string) ?? .null,
                "people": .array(x.people.map { p in .object(["id": .string(p.id), "name": .string(p.name), "label": .string(p.label),
                    "lat": p.lat.map(JSONValue.number) ?? .null, "lon": p.lon.map(JSONValue.number) ?? .null]) }),
                "votes": .array(x.votes.flatMap { key, by in by.map { pid, d in
                    JSONValue.object(["participant_id": .string(pid), "venue_key": .string(key), "dir": .number(Double(d))]) } })]))
        case "mp_update":
            guard let c = code() else { return err("session_not_found") }
            if let i = sessions[c]!.people.firstIndex(where: { $0.id == s("p_participant") }) {
                if a["p_name"] != .null { sessions[c]!.people[i].name = s("p_name") }
                if a["p_label"] != nil && a["p_label"] != .null { sessions[c]!.people[i].label = s("p_label") }
                sessions[c]!.people[i].lat = a["p_lat"]?.double; sessions[c]!.people[i].lon = a["p_lon"]?.double
            }
            return (Data(), 204)
        case "mp_prefs":
            guard let c = code() else { return err("session_not_found") }
            if let v = a["p_cats"], v != .null { sessions[c]!.cats = v }
            if let v = a["p_filters"], v != .null { sessions[c]!.filters = v }
            return (Data(), 204)
        case "mp_results":
            guard let c = code() else { return err("session_not_found") }
            sessions[c]!.results = a["p_results"]; sessions[c]!.resultsBy = s("p_participant")
            return (Data(), 204)
        case "mp_vote":
            guard let c = code() else { return err("session_not_found") }
            let d = Int(a["p_dir"]?.double ?? 0)
            if d == 0 { sessions[c]!.votes[s("p_venue")]?[s("p_participant")] = nil
                        if sessions[c]!.votes[s("p_venue")]?.isEmpty == true { sessions[c]!.votes[s("p_venue")] = nil } }
            else { sessions[c]!.votes[s("p_venue"), default: [:]][s("p_participant")] = d > 0 ? 1 : -1 }
            return (Data(), 204)
        case "mp_leave":
            guard let c = code() else { return err("session_not_found") }
            sessions[c]!.people.removeAll { $0.id == s("p_participant") }
            return (Data(), 204)
        default: return err("unknown function", 404)
        }
    }

    private func overpass() -> (Data, Int) {
        var items: [String] = []
        for (i, v) in venues.enumerated() {
            let tags = v.tags.merging(["name": v.name]) { a, _ in a }
            let t = tags.map { "\"\($0.key)\":\"\($0.value)\"" }.joined(separator: ",")
            items.append(#"{"type":"node","id":\#(i + 1),"lat":\#(v.lat),"lon":\#(v.lon),"tags":{\#(t)}}"#)
        }
        let els = items.joined(separator: ",")
        return (Data(#"{"elements":[\#(els)]}"#.utf8), 200)
    }

    private func osrm(_ url: URL) -> (Data, Int) {
        if routingDown { return (Data(), 503) }
        let path = url.path.components(separatedBy: "/").last ?? ""
        let pts = path.components(separatedBy: ";").map { $0.components(separatedBy: ",").compactMap(Double.init) }.map { Coordinate(lat: $0[1], lon: $0[0]) }
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        let src = q.first { $0.name == "sources" }!.value!.components(separatedBy: ";").compactMap(Int.init)
        let dst = q.first { $0.name == "destinations" }!.value!.components(separatedBy: ";").compactMap(Int.init)
        let rows = src.map { s in "[" + dst.map { d in String(Int(Geo.haversine(pts[s], pts[d]) / 8)) }.joined(separator: ",") + "]" }
        return (Data(#"{"code":"Ok","durations":[\#(rows.joined(separator: ","))]}"#.utf8), 200)
    }

    private func nominatim(_ url: URL) -> (Data, Int) {
        if url.path.hasSuffix("/reverse") { return (Data(#"{"display_name":"Here, There","address":{"neighbourhood":"Wicker Park","city":"Chicago"}}"#.utf8), 200) }
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "q" }!.value!.lowercased()
        let known: [String: (Double, Double, String)] = ["wicker park": (41.9088, -87.6796, "Wicker Park"), "hyde park": (41.7943, -87.5907, "Hyde Park"), "pilsen": (41.8563, -87.6573, "Pilsen")]
        guard let k = known.first(where: { q.contains($0.key) })?.value else { return (Data("[]".utf8), 200) }
        return (Data(#"[{"lat":"\#(k.0)","lon":"\#(k.1)","display_name":"\#(k.2), Chicago, Illinois","address":{"neighbourhood":"\#(k.2)","city":"Chicago","state":"Illinois"}}]"#.utf8), 200)
    }
}

/// Seeded, so a "random" lucky roll is reproducible in a test.
struct SplitMix: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

@MainActor func makePhone(_ w: World, store: KeyValueStore = MemoryStore(), supabase: Bool = true, clock: (@Sendable () -> Date)? = nil) -> AppModel {
    AppModel(transport: w, userAgent: "MidPnt-iOS/test (t@example.com)", supabase: supabase ? World.supabase : nil, store: store,
             rng: SplitMix(state: 7), clock: clock ?? { Date() }, geocodeInterval: 0)
}
