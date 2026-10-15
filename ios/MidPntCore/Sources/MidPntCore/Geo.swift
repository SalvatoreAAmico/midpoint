import Foundation

public struct Coordinate: Hashable, Sendable, Codable {
    public var lat: Double
    public var lon: Double
    public init(lat: Double, lon: Double) { self.lat = lat; self.lon = lon }
}

public enum Geo {
    /// Great-circle distance in metres.
    public static func haversine(_ a: Coordinate, _ b: Coordinate) -> Double {
        let R = 6371000.0, rad = Double.pi / 180
        let dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad
        let la1 = a.lat * rad, la2 = b.lat * rad
        let h = pow(sin(dLat / 2), 2) + cos(la1) * cos(la2) * pow(sin(dLon / 2), 2)
        return 2 * R * asin(h.squareRoot())
    }

    /// Centroid via 3-D cartesian mean, so it behaves near the poles / date line.
    public static func centroid(_ pts: [Coordinate]) -> Coordinate? {
        guard !pts.isEmpty else { return nil }
        let rad = Double.pi / 180
        var x = 0.0, y = 0.0, z = 0.0
        for p in pts {
            let la = p.lat * rad, lo = p.lon * rad
            x += cos(la) * cos(lo)
            y += cos(la) * sin(lo)
            z += sin(la)
        }
        let n = Double(pts.count)
        x /= n; y /= n; z /= n
        return Coordinate(lat: atan2(z, hypot(x, y)) / rad, lon: atan2(y, x) / rad)
    }

    /// Someone far enough from everyone else that no single spot can serve
    /// them. Compared against the median distance so one outlier cannot hide
    /// another. Takes only people who have shared a location.
    public static func findOutliers<T>(_ people: [T], at: (T) -> Coordinate?, flex: (T) -> Bool) -> [T] {
        let located = people.compactMap { p in at(p).map { (p, $0) } }
        if located.count < 3 { return [] }
        let c = centroid(located.map { $0.1 })!
        let d = located.map { haversine($0.1, c) }
        let sorted = d.sorted()
        let median = sorted[sorted.count / 2]
        let m = median == 0 ? 1 : median            // JS: `|| 1`
        return located.enumerated()
            .filter { d[$0.offset] > max(3 * m, 25000) && !flex($0.element.0) }
            .map { $0.element.0 }
    }

    /// JS `Math.round`: halves go up, not away from zero.
    static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }
}
