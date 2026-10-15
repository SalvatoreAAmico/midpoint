import XCTest
@testable import MidPntCore

/// app.js's constants, as exported into catalog.json, against the literals in
/// Limits.swift. Retune SPREAD_WEIGHT in app.js and this fails until the Swift
/// side is retuned in the same commit.
final class LimitsTests: XCTestCase {
    func testSwiftConstantsMatchAppJS() {
        let k = Catalog.shared.constants
        XCTAssertEqual(Limits.maxPeople, k.maxPeople)
        XCTAssertEqual(Limits.maxVenues, k.maxVenues)
        XCTAssertEqual(Limits.speedDrive, k.speed.drive)
        XCTAssertEqual(Limits.speedWalk, k.speed.walk)
        XCTAssertEqual(Limits.maxRadiusDrive, k.maxRadius.drive)
        XCTAssertEqual(Limits.maxRadiusWalk, k.maxRadius.walk)
        XCTAssertEqual(Limits.togetherM, k.togetherM)
        XCTAssertEqual(Limits.togetherRadiusDrive, k.togetherRadius.drive)
        XCTAssertEqual(Limits.togetherRadiusWalk, k.togetherRadius.walk)
        XCTAssertEqual(Limits.spreadWeight, k.spreadWeight)
        XCTAssertEqual(Limits.flexWeight, k.flexWeight)
        XCTAssertEqual(Limits.luckyCats, k.luckyCats)
        XCTAssertEqual(Limits.luckyPool, k.luckyPool)
    }

    func testWalkingIsAPlausiblePace() {
        XCTAssertTrue((3...6).contains(Limits.speedWalk * 3.6), "km/h")
    }
}
