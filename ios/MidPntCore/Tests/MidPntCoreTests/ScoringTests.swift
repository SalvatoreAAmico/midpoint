import XCTest
@testable import MidPntCore

final class ScoringTests: XCTestCase {
    struct Case: Decodable {
        struct P: Decodable { let lat: Double; let lon: Double; let flex: Bool? }
        struct V: Decodable { let key: String; let name: String; let lat: Double; let lon: Double }
        struct Out: Decodable { let key: String; let costs: [Double]; let mean: Double; let spread: Double; let score: Double }
        let name: String; let venues: [V]; let people: [P]
        let matrix: [[Double?]]?; let speed: Double?; let out: [Out]
    }

    func testEveryScoringVector() {
        let cases = Golden.load("scoring", as: [Case].self)
        XCTAssertGreaterThanOrEqual(cases.count, 15)
        for c in cases {
            let travellers = c.people.enumerated().map {
                Traveller(id: "p\($0.offset)", coordinate: Coordinate(lat: $0.element.lat, lon: $0.element.lon), flex: $0.element.flex ?? false)
            }
            let venues = c.venues.map { Venue(key: $0.key, name: $0.name, lat: $0.lat, lon: $0.lon) }
            let got = Scoring.score(venues, travellers: travellers, matrix: c.matrix, speed: c.speed ?? Travel.drive.speed)
            XCTAssertEqual(got.map(\.venue.key), c.out.map(\.key), "ranking: \(c.name)")
            for (g, e) in zip(got, c.out) {
                assertClose(g.score, e.score, "score \(c.name)/\(e.key)")
                assertClose(g.mean, e.mean, "mean \(c.name)/\(e.key)")
                assertClose(g.spread, e.spread, "spread \(c.name)/\(e.key)")
                for (i, t) in travellers.enumerated() { assertClose(g.costs[t.id]!, e.costs[i], "cost \(c.name)/\(e.key)/\(i)") }
            }
        }
    }

    // The properties the product rests on, independent of the vectors.
    func testSpreadBeatsAverage() {
        let people = [Traveller(id: "a", coordinate: .init(lat: 41.90, lon: -87.70)),
                      Traveller(id: "b", coordinate: .init(lat: 41.70, lon: -87.70))]
        let venues = [Venue(key: "a", name: "Lopsided", lat: 41.895, lon: -87.70),
                      Venue(key: "b", name: "Even", lat: 41.80, lon: -87.70)]
        let r = Scoring.score(venues, travellers: people, matrix: nil, speed: Travel.drive.speed)
        XCTAssertEqual(r.first?.venue.name, "Even")
    }

    func testCostsAreKeyedByPersonNotPosition() {
        let people = [Traveller(id: "x", coordinate: .init(lat: 1, lon: 1)), Traveller(id: "y", coordinate: .init(lat: 2, lon: 2))]
        let r = Scoring.score([Venue(key: "v", name: "V", lat: 1, lon: 1)], travellers: people, matrix: [[10], [20]], speed: 1)
        XCTAssertEqual(r[0].costs, ["x": 10, "y": 20])
    }

    func testTiesKeepInputOrder() {
        let p = [Traveller(id: "a", coordinate: .init(lat: 0, lon: 0))]
        let vs = (0..<50).map { Venue(key: "v\($0)", name: "V", lat: 0, lon: 0) }      // identical scores
        XCTAssertEqual(Scoring.score(vs, travellers: p, matrix: nil, speed: 1).map(\.venue.key), vs.map(\.key))
    }

    func testNobodyLocatedScoresNothing() {
        XCTAssertEqual(Scoring.score([Venue(key: "v", name: "V", lat: 0, lon: 0)], travellers: [], matrix: nil, speed: 1), [])
    }

    func testShuffleKeepsEveryElementAndReachesEveryPosition() {
        var g = SystemRandomNumberGenerator()
        let nums = Array(1...10)
        XCTAssertEqual(shuffled(nums, using: &g).sorted(), nums)
        var first = Set<Int>()
        for _ in 0..<400 { first.insert(shuffled(nums, using: &g)[0]) }
        XCTAssertEqual(first.count, 10)
    }
}
