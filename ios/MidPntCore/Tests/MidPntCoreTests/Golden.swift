import Foundation
import XCTest
@testable import MidPntCore

/// Loads the vectors written by `node test/golden.mjs --write`. They live in
/// Tests/golden/, one directory up, rather than in a resource bundle, so that
/// regenerating them needs no Swift build and so that a stale copy cannot hide
/// inside a cached bundle.
enum Golden {
    static let dir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("golden")

    static func load<T: Decodable>(_ name: String, as: T.Type = T.self, file: StaticString = #filePath, line: UInt = #line) -> T {
        let url = dir.appendingPathComponent(name + ".json")
        do { return try JSONDecoder().decode(T.self, from: Data(contentsOf: url)) }
        catch {
            XCTFail("could not load golden/\(name).json: \(error). Run: node test/golden.mjs --write", file: file, line: line)
            fatalError()
        }
    }
}

/// JS and Swift both use IEEE doubles, but libm's sin/cos/asin differ in the
/// last bit or two between V8 and glibc/Darwin. A relative 1e-9 is far below
/// anything visible (a nanometre on an earth radius) and far above that noise.
func close(_ a: Double, _ b: Double, tol: Double = 1e-9) -> Bool {
    if a == b { return true }
    return abs(a - b) <= tol * max(1, abs(a), abs(b))
}

func assertClose(_ a: Double, _ b: Double, _ msg: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(close(a, b), "\(a) vs \(b) \(msg())", file: file, line: line)
}

struct Pt: Codable { let lat: Double; let lon: Double
    var c: Coordinate { Coordinate(lat: lat, lon: lon) } }

/// Dates in vectors are {day, h, m}; the Swift side takes day and minutes
/// directly, so no timezone is involved on either side.
struct At: Codable { let day: Int; let h: Int; let m: Int
    var date: Date {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        // 6 Sep 2026 is a Sunday.
        return cal.date(from: DateComponents(timeZone: cal.timeZone, year: 2026, month: 9, day: 6 + day, hour: h, minute: m))!
    }
    static var utc: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }
}
