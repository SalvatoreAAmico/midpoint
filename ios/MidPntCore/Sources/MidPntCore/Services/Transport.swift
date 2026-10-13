import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking   // URLSession lives here on Linux
#endif

/// The only door to the network. Production uses `URLSessionTransport`; tests
/// inject a fake, which is how the two-calls-per-search budget is asserted.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (data: Data, status: Int)
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession
    public init(session: URLSession = .shared) { self.session = session }
    public func send(_ request: URLRequest) async throws -> (data: Data, status: Int) {
        let (data, response) = try await session.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

public enum ServiceError: Error, Equatable, Sendable {
    case http(service: String, status: Int)
    case badResponse(service: String, detail: String)
    case unreachable(service: String)
}

enum URLEncoding {
    /// JS `encodeURIComponent`.
    static let component: CharacterSet = {
        var s = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        s.insert(charactersIn: "-_.!~*'()")
        return s
    }()
    static func encode(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: component) ?? s }
}
