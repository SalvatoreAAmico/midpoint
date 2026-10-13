import XCTest
@testable import MidPntCore

final class CatalogTests: XCTestCase {
    struct Chains: Decodable { struct C: Decodable { let tags: [String: String]; let name: String?; let out: Bool }; let isChain: [C] }
    struct Cats: Decodable {
        struct S: Decodable { let q: String; let out: [String] }
        struct T: Decodable { let spec: String; let out: String }
        struct Q: Decodable { let center: Pt; let radius: Double; let cats: [String]; let out: String }
        let searchCats: [S]; let tagFilter: [T]; let overpassQuery: [Q]
    }

    func testChains() {
        for c in Golden.load("chains", as: Chains.self).isChain {
            XCTAssertEqual(Chains_.isChain(c.tags, c.name), c.out, "\(c.tags) \(c.name ?? "nil")")
        }
    }

    func testSearchCats() {
        let vectors = Golden.load("categories", as: Cats.self).searchCats
        XCTAssertGreaterThan(vectors.count, 300)       // every word in the catalogue is a query
        for s in vectors {
            XCTAssertEqual(Catalog.shared.search(s.q).map(\.id), s.out, "query '\(s.q)'")
        }
    }

    func testTagFilter() {
        for t in Golden.load("categories", as: Cats.self).tagFilter {
            XCTAssertEqual(Overpass.tagFilter(t.spec), t.out, t.spec)
        }
    }

    func testOverpassQuery() {
        for q in Golden.load("categories", as: Cats.self).overpassQuery {
            XCTAssertEqual(Overpass.query(center: q.center.c, radius: q.radius, cats: q.cats), q.out)
        }
    }

    // The catalogue's own invariants, as unit.mjs asserts them for the JS.
    func testCatalogueShape() {
        let cat = Catalog.shared
        XCTAssertEqual(cat.chipIDs.count, 8)
        XCTAssertEqual(Set(cat.categories.map(\.id)).count, cat.categories.count)
        XCTAssertTrue(cat.categories.allSatisfy { !$0.tags.isEmpty && !$0.syn.isEmpty })
        XCTAssertTrue(cat.categories.allSatisfy { $0.tags.allSatisfy { Overpass.tagFilter($0).hasPrefix("[") } })
        XCTAssertEqual(cat.search("   "), [])
        XCTAssertEqual(cat.search("zzzqqq"), [])
        XCTAssertLessThanOrEqual(cat.search("a").count, 8)
    }
}

// `Chains` is also the name of the enum under test; keep the call sites readable.
enum Chains_ { static func isChain(_ t: [String: String], _ n: String?) -> Bool { MidPntCore.Chains.isChain(tags: t, name: n) } }
