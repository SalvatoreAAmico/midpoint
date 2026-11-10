import XCTest
@testable import MidPntCore

final class VenueTests: XCTestCase {
    struct Parsed: Decodable {
        struct In: Decodable { let elements: [OverpassElement]; let out: [Out] }
        struct Out: Decodable {
            let key: String; let name: String; let kind: String; let lat: Double; let lon: Double
            let town: String; let hours: String; let price: Int?; let chain: Bool
        }
        struct Filt: Decodable {
            struct V: Decodable { let key: String; let name: String; let hours: String; let price: Int?; let chain: Bool }
            struct Opts: Decodable { let noChains: Bool; let at: At?; let maxPrice: String }
            struct Flag: Decodable { let key: String; let open: Bool? }
            struct Res: Decodable { let keys: [String]; let flags: [Flag]; let chainsHidden: Int }
            let name: String; let venues: [V]; let opts: Opts; let out: Res
        }
        let parseVenues: In
        let parseVenuesEmpty: [Int]
        let filterVenues: [Filt]
    }

    func testParseVenues() {
        let g = Golden.load("venues", as: Parsed.self)
        let got = Venues.parse(g.parseVenues.elements)
        XCTAssertEqual(got.count, g.parseVenues.out.count)
        XCTAssertGreaterThan(got.count, 5)
        for (a, e) in zip(got, g.parseVenues.out) {
            XCTAssertEqual(a.key, e.key); XCTAssertEqual(a.name, e.name); XCTAssertEqual(a.kind, e.kind, e.key)
            XCTAssertEqual(a.lat, e.lat); XCTAssertEqual(a.lon, e.lon); XCTAssertEqual(a.town, e.town, e.key)
            XCTAssertEqual(a.hours, e.hours); XCTAssertEqual(a.price, e.price, e.key); XCTAssertEqual(a.chain, e.chain, e.key)
        }
        XCTAssertEqual(Venues.parse(nil).count, 0)
        XCTAssertEqual(g.parseVenuesEmpty, [0, 0, 0])
    }

    func testFilterVenues() {
        for f in Golden.load("venues", as: Parsed.self).filterVenues {
            let venues = f.venues.map { Venue(key: $0.key, name: $0.name, lat: 0, lon: 0, hours: $0.hours, price: $0.price, chain: $0.chain) }
            let got = Venues.filter(venues, .init(noChains: f.opts.noChains, at: f.opts.at?.date, maxPrice: f.opts.maxPrice),
                                    calendar: At.utc)
            XCTAssertEqual(got.venues.map(\.key), f.out.keys, f.name)
            XCTAssertEqual(got.chainsHidden, f.out.chainsHidden, f.name)
            if f.opts.at != nil {     // with no `at`, `open` means "right now", which a vector cannot pin
                XCTAssertEqual(got.venues.map(\.open), f.out.flags.map(\.open), f.name)
            }
        }
    }

    func testVenueToleratesWhatOtherClientsSend() throws {
        let json = #"{"key":"node/1","name":"X","lat":1,"lon":2,"future_field":[1,2],"price":null,"open":null}"#
        let v = try JSONDecoder().decode(Venue.self, from: Data(json.utf8))
        XCTAssertEqual(v.key, "node/1"); XCTAssertNil(v.price); XCTAssertNil(v.open); XCTAssertEqual(v.town, "")
    }
}

final class SessionTests: XCTestCase {
    struct Remap: Decodable {
        struct R: Codable { let people: [String]; let venues: [Shared] }
        struct Shared: Codable { let key: String; let lat: Double; let lon: Double; let name: String; let costs: [Double?] }
        struct Out: Decodable { let key: String; let costs: [Double?]; let mean: Double; let spread: Double }
        struct Person: Decodable { let id: String }
        let name: String; let r: R; let roster: [Person]; let out: [Out]
    }

    func testRemapOntoRoster() throws {
        let cases = Golden.load("remap", as: [Remap].self)
        XCTAssertEqual(cases.count, 4)
        for c in cases {
            let payload = try JSONDecoder().decode(SharedResults.self, from: JSONEncoder().encode(c.r))
            let roster = c.roster.map(\.id)
            let got = payload.remapped(onto: roster)
            XCTAssertEqual(got.map(\.venue.key), c.out.map(\.key), c.name)
            for (g, e) in zip(got, c.out) {
                // Position in the expected array is the roster position; a null there means "no time".
                for (i, id) in roster.enumerated() {
                    if let want = e.costs[i] { assertClose(g.costs[id] ?? .nan, want, c.name) }
                    else { XCTAssertNil(g.costs[id], "\(c.name): \(id) should have no time") }
                }
                assertClose(g.mean, e.mean, c.name); assertClose(g.spread, e.spread, c.name)
            }
        }
    }

    func testJoinerWithNoLocationNeverBorrowsSomeoneElsesTime() throws {
        // The bug that shipped: a joiner at position 1 with no location made every
        // row below them show another person's travel time.
        let json = #"{"at":1,"people":["a","c"],"venues":[{"key":"v","lat":0,"lon":0,"costs":[100,300]}]}"#
        let r = try JSONDecoder().decode(SharedResults.self, from: Data(json.utf8))
        let got = r.remapped(onto: ["a", "b", "c"])[0]
        XCTAssertEqual(got.costs, ["a": 100, "c": 300])
        XCTAssertNil(got.costs["b"])
    }
}
