import XCTest
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import MidPntCore

/// Records every request and answers from a script.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [URLRequest] = []
    var requests: [URLRequest] { lock.withLock { recorded } }
    let handler: @Sendable (URLRequest) throws -> (Data, Int)
    init(_ handler: @escaping @Sendable (URLRequest) throws -> (Data, Int)) { self.handler = handler }
    func send(_ request: URLRequest) async throws -> (data: Data, status: Int) {
        lock.withLock { recorded.append(request) }
        let (d, s) = try handler(request)
        return (d, s)
    }
    var count: Int { lock.withLock { recorded.count } }
}

private func overpassJSON(_ n: Int) -> Data {
    let els = (0..<n).map { i in
        #"{"type":"node","id":\#(i + 1),"lat":\#(41.88 + Double(i) * 0.001),"lon":-87.63,"tags":{"name":"Place \#(i)","amenity":"cafe"}}"#
    }.joined(separator: ",")
    return Data(#"{"elements":[\#(els)]}"#.utf8)
}

private func osrmJSON(people: Int, venues: Int) -> Data {
    let row = (0..<venues).map { String(300 + $0 * 10) }.joined(separator: ",")
    let rows = (0..<people).map { _ in "[\(row)]" }.joined(separator: ",")
    return Data(#"{"code":"Ok","durations":[\#(rows)]}"#.utf8)
}

private func respond(_ r: URLRequest, venues: Int = 12, people n: Int) throws -> (Data, Int) {
    r.url!.host == "router.project-osrm.org" ? (osrmJSON(people: n, venues: venues), 200) : (overpassJSON(venues), 200)
}

final class ServiceTests: XCTestCase {
    private func people(_ n: Int) -> [Traveller] {
        (0..<n).map { Traveller(id: "p\($0)", coordinate: .init(lat: 41.85 + Double($0) * 0.01, lon: -87.65 + Double($0) * 0.01)) }
    }
    private func run(group n: Int, transport: FakeTransport) async throws -> SearchOutcome {
        try await Search.run(located: people(n), cats: ["coffee"], travel: .drive,
                             filter: .init(noChains: true, at: nil, maxPrice: ""),
                             overpass: OverpassClient(transport: transport), osrm: OSRM(transport: transport))
    }

    // THE budget: two calls, whatever the group size.
    func testASearchIsTwoHTTPCallsWhateverTheGroupSize() async throws {
        for n in [1, 2, 4, 8] {
            let t = FakeTransport { r in try respond(r, people: n) }
            let out = try await run(group: n, transport: t)
            XCTAssertEqual(t.count, 2, "group of \(n)")
            XCTAssertEqual(t.requests.map { $0.url!.host }, ["overpass-api.de", "router.project-osrm.org"])
            XCTAssertFalse(out.estimated); XCTAssertEqual(out.results.count, 12)
        }
    }

    func testRoutingOutageDegradesToMarkedEstimatesNotAFailure() async throws {
        let t = FakeTransport { r in
            r.url!.host == "router.project-osrm.org" ? (Data(), 503) : (overpassJSON(5), 200) }
        let out = try await run(group: 3, transport: t)
        XCTAssertTrue(out.estimated); XCTAssertEqual(out.results.count, 5)
        XCTAssertEqual(t.count, 2)
    }

    func testOverpassFallsOverToItsMirror() async throws {
        let t = FakeTransport { r in
            switch r.url!.host {
            case "overpass-api.de": return (Data(), 504)
            case "overpass.kumi.systems": return (overpassJSON(4), 200)
            default: return (osrmJSON(people: 2, venues: 4), 200)
            }
        }
        let out = try await run(group: 2, transport: t)
        XCTAssertEqual(out.results.count, 4)
        XCTAssertEqual(t.requests.map { $0.url!.host }, ["overpass-api.de", "overpass.kumi.systems", "router.project-osrm.org"])
    }

    func testBothOverpassHostsDownIsAnError() async {
        let t = FakeTransport { _ in (Data(), 429) }
        do { _ = try await run(group: 2, transport: t); XCTFail("expected a throw") }
        catch let e as ServiceError { XCTAssertEqual(e, .http(service: "Overpass", status: 429)) }
        catch { XCTFail("\(error)") }
    }

    func testNothingMatchingMakesNoRoutingCall() async throws {
        let t = FakeTransport { r in try respond(r, venues: 0, people: 2) }
        let out = try await run(group: 2, transport: t)
        XCTAssertTrue(out.empty); XCTAssertEqual(t.count, 1)
    }

    func testTheMatrixIsCappedSoTheURLStaysShort() async throws {
        let t = FakeTransport { r in
            r.url!.host == "router.project-osrm.org"
                ? (osrmJSON(people: 8, venues: Limits.maxVenues), 200) : (overpassJSON(60), 200) }
        let out = try await run(group: 8, transport: t)
        XCTAssertEqual(out.results.count, Limits.maxVenues)
        let osrm = t.requests.last!.url!.absoluteString
        XCTAssertEqual(osrm.components(separatedBy: ";").count - 1 >= 8 + Limits.maxVenues - 1, true)
        XCTAssertLessThan(osrm.count, 2000)
    }

    func testOSRMURLShapeMatchesTheWebApp() {
        let url = OSRM.url(from: [.init(lat: 41.9, lon: -87.67), .init(lat: 41.7, lon: -87.7)],
                           to: [.init(lat: 41.8, lon: -87.6)], profile: .driving).absoluteString
        XCTAssertEqual(url, "https://router.project-osrm.org/table/v1/driving/-87.67000,41.90000;-87.70000,41.70000;-87.60000,41.80000?sources=0;1&destinations=2&annotations=duration")
    }

    func testOverpassPostsAFormEncodedBody() async throws {
        let t = FakeTransport { _ in (overpassJSON(1), 200) }
        _ = try await OverpassClient(transport: t).venues(center: .init(lat: 41.9, lon: -87.7), radius: 1500, cats: ["coffee"])
        let r = t.requests[0]
        XCTAssertEqual(r.httpMethod, "POST")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
        XCTAssertTrue(String(decoding: r.httpBody!, as: UTF8.self).hasPrefix("data=%5Bout%3Ajson%5D"))
    }

    // Nominatim ---------------------------------------------------------

    func testNominatimIdentifiesItselfAndCaches() async throws {
        let t = FakeTransport { _ in (Data(#"[{"lat":"41.9088","lon":"-87.6796","display_name":"Wicker Park, Chicago, Illinois","address":{"neighbourhood":"Wicker Park","city":"Chicago","state":"Illinois"}}]"#.utf8), 200) }
        let n = Nominatim(transport: t, userAgent: "MidPnt-iOS/1.0 (support@example.com)", minInterval: 0)
        let a = try await n.geocode("Wicker Park, Chicago")
        let b = try await n.geocode("  wicker park, chicago ")
        XCTAssertEqual(a?.label, "Wicker Park, Chicago"); XCTAssertEqual(a, b)
        XCTAssertEqual(t.count, 1, "the second lookup comes from the cache")
        XCTAssertEqual(t.requests[0].value(forHTTPHeaderField: "User-Agent"), "MidPnt-iOS/1.0 (support@example.com)")
        XCTAssertEqual(t.requests[0].url!.absoluteString,
                       "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=Wicker%20Park%2C%20Chicago")
    }

    func testNoMatchIsNilNotAnError() async throws {
        let t = FakeTransport { _ in (Data("[]".utf8), 200) }
        let r = try await Nominatim(transport: t, userAgent: "x", minInterval: 0).geocode("zzzz")
        XCTAssertNil(r)
    }

    func testNominatimNeverExceedsOneRequestPerSecond() async throws {
        let t = FakeTransport { _ in (Data("[]".utf8), 200) }
        let n = Nominatim(transport: t, userAgent: "x", minInterval: 0.25)
        let start = Date()
        for q in ["a", "b", "c"] { _ = try await n.geocode(q) }
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(start), 0.45)    // 3 calls, 2 gaps
    }

    func testReverseGeocodeCachesByRoundedCoordinate() async throws {
        let t = FakeTransport { _ in (Data(#"{"display_name":"X, Y, Z","address":{"village":"Stow","state":"Massachusetts"}}"#.utf8), 200) }
        let n = Nominatim(transport: t, userAgent: "x", minInterval: 0)
        let a = try await n.reverse(lat: 42.4370, lon: -71.5100)
        let b = try await n.reverse(lat: 42.43701, lon: -71.51001)
        XCTAssertEqual(a, "Stow, Massachusetts"); XCTAssertEqual(a, b); XCTAssertEqual(t.count, 1)
    }
}
