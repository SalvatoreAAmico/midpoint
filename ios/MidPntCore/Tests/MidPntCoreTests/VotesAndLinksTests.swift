import XCTest
@testable import MidPntCore

final class VotesAndLinksTests: XCTestCase {
    struct V: Decodable {
        struct T: Decodable { let votes: Votes; let key: String; let out: Out; struct Out: Decodable { let up: Int; let down: Int } }
        struct W: Decodable { let name: String; let votes: Votes; let people: [P]; let results: [R]; let out: String?
            struct P: Decodable { let id: String; let lat: Double? }; struct R: Decodable { let key: String } }
        let tally: [T]; let winner: [W]
    }
    struct M: Decodable { let app: String; let venue: Vn; let out: String; struct Vn: Decodable { let name: String; let lat: Double; let lon: Double } }

    func testTally() {
        for t in Golden.load("votes", as: V.self).tally {
            let got = VoteBook.tally(t.votes, t.key)
            XCTAssertEqual(got.up, t.out.up); XCTAssertEqual(got.down, t.out.down)
        }
    }

    func testWinner() {
        let cases = Golden.load("votes", as: V.self).winner
        XCTAssertGreaterThanOrEqual(cases.count, 11)
        for c in cases {
            let people = c.people.map { Person(id: $0.id, lat: $0.lat, lon: $0.lat == nil ? nil : 1) }
            let results = c.results.map { ScoredVenue(venue: Venue(key: $0.key, name: $0.key, lat: 0, lon: 0), costs: [:], mean: 0, spread: 0, score: 0) }
            XCTAssertEqual(VoteBook.winner(votes: c.votes, people: people, results: results)?.venue.key, c.out, c.name)
        }
    }

    func testMapsLinksMatchTheWebApp() {
        let vectors = Golden.load("maps", as: [M].self)
        XCTAssertEqual(vectors.count, 9)
        for m in vectors { XCTAssertEqual(Maps.url(name: m.venue.name, lat: m.venue.lat, lon: m.venue.lon, app: Maps.App(rawValue: m.app)!), m.out, m.app) }
    }

    func testToggleRetractsAndForgets() {
        var v: Votes = [:]
        XCTAssertEqual(VoteBook.toggle(&v, key: "x", me: "a", dir: 1), 1)
        XCTAssertEqual(VoteBook.toggle(&v, key: "x", me: "a", dir: -1), -1)      // changed mind
        XCTAssertEqual(VoteBook.toggle(&v, key: "x", me: "a", dir: -1), 0)       // tapped again: retracted
        XCTAssertTrue(v.isEmpty)
    }

    func testLuckyNeverRerollsIntoTheSameSet() {
        var g = SplitMix(state: 1)
        var cats = Lucky.roll(current: ["coffee"], wasLucky: false, using: &g)
        XCTAssertEqual(cats.count, Limits.luckyCats)
        for _ in 0..<200 {
            let next = Lucky.roll(current: cats, wasLucky: true, using: &g)
            XCTAssertFalse(next.allSatisfy(cats.contains), "\(cats) -> \(next)")
            cats = next
        }
    }

    func testLuckyShufflesOnlyTheFairestHandful() {
        var g = SplitMix(state: 3)
        let r = (0..<30).map { ScoredVenue(venue: Venue(key: "v\($0)", name: "", lat: 0, lon: 0), costs: [:], mean: 0, spread: 0, score: Double($0)) }
        let s = Lucky.shuffleFairest(r, using: &g)
        XCTAssertEqual(Set(s.prefix(12).map(\.venue.key)), Set(r.prefix(12).map(\.venue.key)))
        XCTAssertEqual(s.dropFirst(12).map(\.venue.key), r.dropFirst(12).map(\.venue.key))
    }

    func testInvites() {
        XCTAssertEqual(Invite.parse(URL(string: "https://salvatoreaamico.com/midpoint/?s=A1B2C3D4E5")!)?.sessionCode, "a1b2c3d4e5")
        XCTAssertNil(Invite.parse(URL(string: "https://salvatoreaamico.com/other/?s=abc")!), "someone else's path")
        XCTAssertNil(Invite.parse(URL(string: "https://example.com/midpoint/?s=abc")!), "someone else's host")
        XCTAssertNil(Invite.parse(URL(string: "https://salvatoreaamico.com/midpoint/")!))
        // The no-backend hash link, built exactly as the web app builds it.
        let payload = #"{"p":[["a","Sal",41.9,-87.6,"Home",0]],"c":["food"]}"#
        let hash = Data(payload.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let inv = Invite.parse(URL(string: "https://salvatoreaamico.com/midpoint/#\(hash)")!)
        XCTAssertNil(inv?.sessionCode); XCTAssertEqual(inv?.state?.cats, ["food"]); XCTAssertEqual(inv?.state?.people.first?.name, "Sal")
        // Both at once: a session link that also carries local state.
        XCTAssertEqual(Invite.parse(URL(string: "https://salvatoreaamico.com/midpoint/?s=abc#\(hash)")!)?.sessionCode, "abc")
        XCTAssertEqual(Invite.shareURL(code: "abc").absoluteString, "https://salvatoreaamico.com/midpoint/?s=abc")
    }

    func testStorageKeysAreTheWebAppsKeys() {
        XCTAssertEqual([StoreKey.session, StoreKey.groups, StoreKey.name, StoreKey.mine, StoreKey.maps],
                       ["midpoint.session", "midpoint.groups", "midpoint.name", "midpoint.mine", "midpoint.maps"])
    }

    func testGroupsSurviveGarbageInStorage() {
        let s = MemoryStore()
        s.set(#"[{"id":"1","name":"Crew","people":[]},{"nonsense":true},{"id":"2","name":"","people":[]}]"#, forKey: StoreKey.groups)
        XCTAssertEqual(GroupStore.load(s).map(\.name), ["Crew"])
        s.set("not json", forKey: StoreKey.groups)
        XCTAssertEqual(GroupStore.load(s), [])
    }
}
