import XCTest
@testable import MidPntCore

final class GeoAndHoursTests: XCTestCase {
    struct Geo_: Decodable {
        struct H: Decodable { let a: Pt; let b: Pt; let out: Double }
        struct C: Decodable { let pts: [Pt]; let out: Pt }
        struct O: Decodable { let people: [P]; let out: [String]
            struct P: Decodable { let id: String; let lat: Double?; let lon: Double?; let flex: Bool? } }
        struct A: Decodable { let located: [Pt]; let travel: String
            struct Out: Decodable { let center: Pt; let together: Bool; let radius: Double }
            let out: Out }
        let haversine: [H]; let centroid: [C]; let outliers: [O]; let searchArea: [A]
    }

    func testHaversine() {
        for h in Golden.load("geo", as: Geo_.self).haversine {
            assertClose(MidPntCore.Geo.haversine(h.a.c, h.b.c), h.out, "\(h.a) \(h.b)")
        }
    }

    func testCentroid() {
        for c in Golden.load("geo", as: Geo_.self).centroid {
            let got = MidPntCore.Geo.centroid(c.pts.map(\.c))!
            assertClose(got.lat, c.out.lat); assertClose(got.lon, c.out.lon)
        }
        XCTAssertNil(MidPntCore.Geo.centroid([]))
    }

    func testOutliers() {
        for o in Golden.load("geo", as: Geo_.self).outliers {
            let got = MidPntCore.Geo.findOutliers(o.people,
                at: { p in p.lat.flatMap { la in p.lon.map { Coordinate(lat: la, lon: $0) } } },
                flex: { $0.flex ?? false }).map(\.id)
            XCTAssertEqual(got, o.out)
        }
    }

    func testSearchArea() {
        for a in Golden.load("geo", as: Geo_.self).searchArea {
            let got = Venues.searchArea(located: a.located.map(\.c), travel: Travel(rawValue: a.travel)!)
            XCTAssertEqual(got.together, a.out.together, "\(a.located) \(a.travel)")
            assertClose(got.radius, a.out.radius, "radius")
            assertClose(got.center.lat, a.out.center.lat); assertClose(got.center.lon, a.out.center.lon)
        }
    }

    struct Hrs: Decodable {
        struct O: Decodable { let spec: String; let at: At; let out: Bool? }
        struct P: Decodable { let tags: [String: String]; let out: Int? }
        struct F: Decodable { let s: Double?; let out: String }
        let isOpenNow: [O]; let priceLevel: [P]; let fmtMin: [F]
    }

    func testIsOpenNow() {
        for o in Golden.load("hours", as: Hrs.self).isOpenNow {
            XCTAssertEqual(Hours.isOpen(o.spec, day: o.at.day, minutes: o.at.h * 60 + o.at.m), o.out,
                           "'\(o.spec)' on day \(o.at.day) at \(o.at.h):\(o.at.m)")
        }
    }

    func testIsOpenNowThroughDate() {
        // The Date entry point must agree with day/minutes (and ignore the host timezone).
        let at = At(day: 3, h: 23, m: 0)
        XCTAssertEqual(Hours.isOpen("Mo-Su 17:00-02:00", at: at.date, calendar: At.utc), true)
        XCTAssertEqual(Hours.isOpen("Mo-Fr 08:00-18:00", at: at.date, calendar: At.utc), false)
    }

    func testPriceLevel() {
        for p in Golden.load("hours", as: Hrs.self).priceLevel {
            XCTAssertEqual(Hours.priceLevel(p.tags), p.out, "\(p.tags)")
        }
    }

    func testFmtMin() {
        for f in Golden.load("hours", as: Hrs.self).fmtMin {
            XCTAssertEqual(Hours.fmtMin(f.s), f.out)
        }
    }
}
