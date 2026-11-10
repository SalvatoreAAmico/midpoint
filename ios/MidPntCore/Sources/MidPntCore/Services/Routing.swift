import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Everyone-to-every-venue travel times in ONE request. Four people times
/// twenty-five venues is a hundred durations for a single HTTP call. Never
/// MKDirections: that is per pair, exactly the shape the budget forbids.
public struct OSRM: Sendable {
    public static let base = "https://router.project-osrm.org/table/v1/"
    private let transport: HTTPTransport
    public init(transport: HTTPTransport) { self.transport = transport }

    public enum Profile: String, Sendable { case driving, foot
        public init(_ t: Travel) { self = t == .walk ? .foot : .driving } }

    static func url(from people: [Coordinate], to venues: [Coordinate], profile: Profile) -> URL {
        let coords = (people + venues).map { String(format: "%.5f,%.5f", $0.lon, $0.lat) }.joined(separator: ";")
        let sources = people.indices.map(String.init).joined(separator: ";")
        let dests = venues.indices.map { String($0 + people.count) }.joined(separator: ";")
        return URL(string: "\(base)\(profile.rawValue)/\(coords)?sources=\(sources)&destinations=\(dests)&annotations=duration")!
    }

    /// `[person][venue]` seconds; a nil entry is a pair OSRM could not route.
    public func durations(from people: [Coordinate], to venues: [Coordinate], profile: Profile) async throws -> [[Double?]] {
        var req = URLRequest(url: Self.url(from: people, to: venues, profile: profile), timeoutInterval: 12)
        req.setValue("MidPnt-iOS", forHTTPHeaderField: "User-Agent")
        let (data, status) = try await transport.send(req)
        guard (200..<300).contains(status) else { throw ServiceError.http(service: "OSRM", status: status) }
        struct Body: Decodable { let code: String; let durations: [[Double?]]? }
        guard let b = try? JSONDecoder().decode(Body.self, from: data), b.code == "Ok", let d = b.durations,
              d.count == people.count, d.allSatisfy({ $0.count == venues.count })
        else { throw ServiceError.badResponse(service: "OSRM", detail: "no usable matrix") }
        return d
    }
}

public struct OverpassClient: Sendable {
    private let transport: HTTPTransport
    private let hosts: [String]
    public init(transport: HTTPTransport, hosts: [String] = Overpass.hosts) { self.transport = transport; self.hosts = hosts }

    /// One call, all categories ORed. Falls over to the mirror on any failure.
    public func venues(center: Coordinate, radius: Double, cats: [String]) async throws -> [Venue] {
        let body = "data=" + URLEncoding.encode(Overpass.query(center: center, radius: radius, cats: cats))
        var last: Error = ServiceError.unreachable(service: "Overpass")
        for host in hosts {
            do {
                var req = URLRequest(url: URL(string: host)!)
                req.httpMethod = "POST"
                req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                req.httpBody = Data(body.utf8)
                let (data, status) = try await transport.send(req)
                guard (200..<300).contains(status) else { throw ServiceError.http(service: "Overpass", status: status) }
                let r = try JSONDecoder().decode(OverpassResponse.self, from: data)
                return Venues.parse(r.elements)
            } catch { last = error }
        }
        throw last
    }
}
