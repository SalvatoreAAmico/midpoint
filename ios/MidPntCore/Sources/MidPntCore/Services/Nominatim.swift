import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct Place: Hashable, Sendable { public let lat: Double; public let lon: Double; public let label: String }

/// Nominatim, at its usage policy: an identifying User-Agent (a browser cannot
/// set one, an app must — without it we are blocked, and the block would hit
/// the web app's shared IP reputation too), at most one request a second, and
/// never per venue. Results are cached for the life of the process.
public actor Nominatim {
    public static let base = "https://nominatim.openstreetmap.org"

    private let transport: HTTPTransport
    private let userAgent: String
    private let minInterval: TimeInterval
    private var last: Date = .distantPast
    private var geoCache: [String: Place] = [:]
    private var revCache: [String: String] = [:]

    /// - Parameter userAgent: `MidPnt-iOS/<version> (<support email>)`.
    public init(transport: HTTPTransport, userAgent: String, minInterval: TimeInterval = 1.0) {
        self.transport = transport; self.userAgent = userAgent; self.minInterval = minInterval
    }

    static func searchURL(_ q: String) -> URL {
        URL(string: "\(base)/search?format=jsonv2&addressdetails=1&limit=1&q=\(URLEncoding.encode(q))")!
    }
    static func reverseURL(lat: Double, lon: Double) -> URL {
        URL(string: "\(base)/reverse?format=jsonv2&zoom=14&lat=\(lat)&lon=\(lon)")!
    }

    /// nil = no match (not an error: "No match — try adding the city").
    public func geocode(_ q: String) async throws -> Place? {
        let key = q.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if key.isEmpty { return nil }
        if let hit = geoCache[key] { return hit }
        struct Hit: Decodable { let lat: String; let lon: String; let display_name: String?; let address: [String: String]? }
        let hits: [Hit] = try await get(Self.searchURL(q))
        guard let h = hits.first, let lat = Double(h.lat), let lon = Double(h.lon) else { return nil }
        let out = Place(lat: lat, lon: lon, label: Names.placeName(h.address, displayName: h.display_name ?? ""))
        geoCache[key] = out
        return out
    }

    /// Coordinates -> a name a human recognises. "My location" tells you
    /// nothing about where you actually are.
    public func reverse(lat: Double, lon: Double) async throws -> String {
        let key = String(format: "%.4f,%.4f", lat, lon)
        if let hit = revCache[key] { return hit }
        struct Hit: Decodable { let display_name: String?; let address: [String: String]? }
        let h: Hit = try await get(Self.reverseURL(lat: lat, lon: lon))
        let out = Names.placeName(h.address, displayName: h.display_name ?? "")
        revCache[key] = out
        return out
    }

    private func get<T: Decodable>(_ url: URL) async throws -> T {
        // Serial by construction (this is an actor), so the floor holds.
        let wait = minInterval - Date().timeIntervalSince(last)
        if wait > 0 { try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
        last = Date()
        var req = URLRequest(url: url)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        let (data, status) = try await transport.send(req)
        guard (200..<300).contains(status) else { throw ServiceError.http(service: "Nominatim", status: status) }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw ServiceError.badResponse(service: "Nominatim", detail: "\(error)") }
    }
}
