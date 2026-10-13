import XCTest
@testable import MidPntCore

final class LinkAndNameTests: XCTestCase {
    struct StateCase: Decodable {
        struct P: Decodable { let id: String?; let name: String; let lat: Double?; let lon: Double?; let label: String; let flex: Bool }
        struct Out: Decodable {
            let people: [P]; let cats: [String]; let when: String; let whenTime: String; let travel: String
            let maxPrice: String; let lucky: Bool; let noChains: Bool
            let votes: [String: [String: Int]]; let hashMe: String?
        }
        let name: String; let hash: String; let out: Out?
    }

    func testEveryLinkParsesLikeTheWebApp() {
        let cases = Golden.load("state", as: [StateCase].self)
        XCTAssertGreaterThan(cases.count, 15)
        for c in cases {
            let got = LinkState.parse(c.hash)
            guard let e = c.out else { XCTAssertNil(got, c.name); continue }
            guard let got else { XCTFail("\(c.name): expected a state, got nil"); continue }
            XCTAssertEqual(got.people.map(\.id), e.people.map { $0.id ?? "" }, c.name)
            XCTAssertEqual(got.people.map(\.name), e.people.map(\.name), c.name)
            XCTAssertEqual(got.people.map(\.lat), e.people.map(\.lat), c.name)
            XCTAssertEqual(got.people.map(\.lon), e.people.map(\.lon), c.name)
            XCTAssertEqual(got.people.map(\.label), e.people.map(\.label), c.name)
            XCTAssertEqual(got.people.map(\.flex), e.people.map(\.flex), c.name)
            XCTAssertEqual(got.cats, e.cats, c.name); XCTAssertEqual(got.when, e.when, c.name)
            XCTAssertEqual(got.whenTime, e.whenTime, c.name); XCTAssertEqual(got.travel.rawValue, e.travel, c.name)
            XCTAssertEqual(got.maxPrice, e.maxPrice, c.name); XCTAssertEqual(got.lucky, e.lucky, c.name)
            XCTAssertEqual(got.noChains, e.noChains, c.name); XCTAssertEqual(got.votes, e.votes, c.name)
            XCTAssertEqual(got.hashMe, e.hashMe, c.name)
        }
    }

    struct Names_: Decodable {
        struct C: Decodable { let id: String; let out: String }
        struct P: Decodable { let addr: [String: String]?; let display: String; let out: String }
        struct S: Decodable { let people: [N]; let out: String }
        struct N: Decodable { let name: String? }
        struct G: Decodable {
            struct In: Decodable { let id: String?; let name: String?; let nameAuto: Bool?; let label: String?; let lat: Double?; let lon: Double?; let flex: Bool? }
            struct M: Decodable { let name: String; let label: String; let lat: Double?; let lon: Double?; let flex: Bool }
            struct Out: Decodable { let name: String; let people: [M] }
            let name: String; let people: [In]; let out: Out
        }
        let codename: [C]; let placeName: [P]; let suggestGroupName: [S]; let groupFromPeople: [G]
    }

    func testCodenames() {
        let g = Golden.load("misc", as: Names_.self)
        XCTAssertGreaterThan(g.codename.count, 60)
        for c in g.codename { XCTAssertEqual(Names.codename(c.id), c.out, "id '\(c.id)'") }
    }

    func testPlaceNames() {
        for p in Golden.load("misc", as: Names_.self).placeName {
            XCTAssertEqual(Names.placeName(p.addr, displayName: p.display), p.out, "\(String(describing: p.addr)) / \(p.display)")
        }
    }

    func testSuggestedGroupNames() {
        for s in Golden.load("misc", as: Names_.self).suggestGroupName {
            XCTAssertEqual(Names.suggestGroupName(s.people.map { Person(id: "", name: $0.name ?? "") }), s.out)
        }
    }

    func testSavedGroups() {
        for g in Golden.load("misc", as: Names_.self).groupFromPeople {
            let people = g.people.enumerated().map { Person(id: $0.element.id ?? "i\($0.offset)", name: $0.element.name ?? "",
                lat: $0.element.lat, lon: $0.element.lon, label: $0.element.label ?? "", flex: $0.element.flex ?? false) }
            let auto = Set(g.people.enumerated().filter { $0.element.nameAuto == true }.map { people[$0.offset].id })
            let got = SavedGroup.from(name: g.name, people: people, autoNamed: auto)
            XCTAssertEqual(got.name, g.out.name, g.name)
            XCTAssertEqual(got.people.map(\.name), g.out.people.map(\.name), g.name)
            XCTAssertEqual(got.people.map(\.label), g.out.people.map(\.label), g.name)
            XCTAssertEqual(got.people.map(\.lat), g.out.people.map(\.lat), g.name)
            XCTAssertEqual(got.people.map(\.flex), g.out.people.map(\.flex), g.name)
        }
    }

    func testSavedGroupsSurviveTheRoundTripThroughUserDefaultsEncoding() throws {
        let g = SavedGroup.from(name: "Crew", people: [Person(id: "a", name: "Sal", lat: 1, lon: 2, label: "Home", flex: true)])
        let back = try JSONDecoder().decode(SavedGroup.self, from: JSONEncoder().encode(g))
        XCTAssertEqual(back, g)
    }
}
