import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The eight `mp_*` calls, and nothing else. The anon key has no table access
/// at all (supabase/schema.sql); this is `URLSession` plus `Codable`, not an
/// SDK. Wire format: docs/session-contract.md.
public actor SessionClient {
    public private(set) var code: String?
    public private(set) var me: String?
    /// A project without fix-002 / fix-003 degrades instead of failing.
    public private(set) var needsMigration = false
    public private(set) var needsResults = false
    public private(set) var requests = 0

    private let config: SupabaseConfig
    private let transport: HTTPTransport
    private let store: KeyValueStore

    public init(config: SupabaseConfig, transport: HTTPTransport, store: KeyValueStore) {
        self.config = config; self.transport = transport; self.store = store
    }

    public var live: Bool { code != nil }
    public nonisolated var configured: Bool { config.configured }

    // MARK: wire

    @discardableResult
    func rpc(_ fn: String, _ args: [String: JSONValue] = [:]) async throws -> Data {
        guard config.configured else { throw SyncError.notConfigured }
        requests += 1
        var req = URLRequest(url: URL(string: "\(config.url)/rest/v1/rpc/\(fn)")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(config.key, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(config.key)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(args)
        let (data, status) = try await transport.send(req)
        if (200..<300).contains(status) { return data }
        var detail = ""
        if case .object(let o)? = try? JSONDecoder().decode(JSONValue.self, from: data) { detail = o["message"]?.string ?? "" }
        if detail.contains("session_not_found") { throw SyncError.sessionNotFound }
        if detail.contains("session_full") { throw SyncError.sessionFull }
        throw Self.isMissing(detail) ? SyncError.missingFunction(detail) : SyncError.server(detail.isEmpty ? "Server error \(status)" : detail)
    }

    static func isMissing(_ m: String) -> Bool {
        m.contains("PGRST202") || m.contains("Could not find the function") || m.contains("does not exist")
    }

    /// `label` is added by fix-002. Until it has been run, fall back to the
    /// original argument list so the app keeps working rather than failing
    /// silently on every write.
    private func compat(_ fn: String, withLabel: [String: JSONValue], without: [String: JSONValue]) async throws -> Data {
        do { return try await rpc(fn, withLabel) }
        catch SyncError.missingFunction {
            needsMigration = true
            return try await rpc(fn, without)
        }
    }

    private static func num(_ d: Double?) -> JSONValue { d.map(JSONValue.number) ?? .null }

    // MARK: identity (survives relaunch, or opening a link joins you again and again)

    private func remember() {
        guard let code, let me else { return }
        let v: JSONValue = .object(["code": .string(code), "me": .string(me)])
        if let d = try? JSONEncoder().encode(v) { store.set(String(decoding: d, as: UTF8.self), forKey: StoreKey.session) }
    }
    private func forget() { store.set(nil, forKey: StoreKey.session) }

    /// Who you already are in `code`, if this device has been in it.
    public func recall(_ code: String) -> String? {
        guard let s = store.string(forKey: StoreKey.session), let d = s.data(using: .utf8),
              case .object(let o)? = try? JSONDecoder().decode(JSONValue.self, from: d),
              o["code"]?.string == code, let me = o["me"]?.string, !me.isEmpty else { return nil }
        return me
    }

    // MARK: calls

    public func create(name: String, label: String, lat: Double?, lon: Double?) async throws -> String {
        let data = try await compat("mp_create",
            withLabel: ["p_name": .string(name), "p_label": .string(label), "p_lat": Self.num(lat), "p_lon": Self.num(lon)],
            without: ["p_name": .string(name), "p_lat": Self.num(lat), "p_lon": Self.num(lon)])
        guard case .object(let o) = try JSONDecoder().decode(JSONValue.self, from: data),
              let c = o["code"]?.string, let pid = o["participant_id"]?.string else { throw SyncError.server("Unexpected reply") }
        code = c; me = pid; remember()
        return c
    }

    public func join(code raw: String, name: String, label: String, lat: Double?, lon: Double?) async throws {
        let c = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let data = try await compat("mp_join",
            withLabel: ["p_code": .string(c), "p_name": .string(name), "p_label": .string(label), "p_lat": Self.num(lat), "p_lon": Self.num(lon)],
            without: ["p_code": .string(c), "p_name": .string(name), "p_lat": Self.num(lat), "p_lon": Self.num(lon)])
        guard case .object(let o) = try JSONDecoder().decode(JSONValue.self, from: data),
              let pid = o["participant_id"]?.string else { throw SyncError.server("Unexpected reply") }
        code = c; me = pid; remember()
    }

    /// Rejoin as yourself if the session still knows you; nil if not (left,
    /// expired, or a session this device never joined). Relaunching from a
    /// link must not create a second copy of you.
    public func resume(code raw: String) async throws -> RemoteState? {
        let c = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let who = recall(c) else { return nil }
        let state = try await fetch(code: c)
        guard state.people.contains(where: { $0.id == who }) else { return nil }
        code = c; me = who
        return state
    }

    public func fetch(code c: String? = nil) async throws -> RemoteState {
        guard let c = c ?? code else { throw SyncError.sessionNotFound }
        return try RemoteState.decode(try await rpc("mp_state", ["p_code": .string(c)]))
    }

    /// The place name travels too; without it everyone else sees a pin with no label.
    public func push(name: String, label: String, lat: Double?, lon: Double?) async throws {
        guard let code, let me else { return }
        _ = try await compat("mp_update",
            withLabel: ["p_code": .string(code), "p_participant": .string(me), "p_name": .string(name),
                        "p_label": .string(label), "p_lat": Self.num(lat), "p_lon": Self.num(lon)],
            without: ["p_code": .string(code), "p_participant": .string(me), "p_name": .string(name),
                      "p_lat": Self.num(lat), "p_lon": Self.num(lon)])
    }

    public func prefs(cats: [String], filters: Filters) async {
        guard let code else { return }
        _ = try? await rpc("mp_prefs", ["p_code": .string(code), "p_cats": .array(cats.map(JSONValue.string)), "p_filters": filters.json])
    }

    /// One search serves the session. The payload carries the participant ids
    /// it was computed for, so every device can map times to the right person.
    public func share(results: JSONValue) async throws {
        guard let code, let me else { return }
        do {
            _ = try await rpc("mp_results", ["p_code": .string(code), "p_participant": .string(me), "p_results": results])
            needsResults = false
        } catch SyncError.missingFunction(let m) {
            // Name the missing migration rather than "check your connection".
            needsResults = true
            throw SyncError.missingFunction(m)
        }
    }

    public func vote(key: String, dir: Int) async {
        guard let code, let me else { return }
        _ = try? await rpc("mp_vote", ["p_code": .string(code), "p_participant": .string(me),
                                       "p_venue": .string(key), "p_dir": .number(Double(dir))])
    }

    public func leave() async {
        guard let code, let me else { return }
        self.code = nil; self.me = nil; forget()
        _ = try? await rpc("mp_leave", ["p_code": .string(code), "p_participant": .string(me)])
    }

    /// Forget locally without telling the server (session ended on a timer).
    public func detach() { code = nil; me = nil; forget() }
}
