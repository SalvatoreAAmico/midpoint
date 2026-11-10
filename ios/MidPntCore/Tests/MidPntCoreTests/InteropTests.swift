import XCTest
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import MidPntCore

/// Runs only under `bash test/ios-interop.sh`, which points MP_RPC_URL at a
/// PostgREST stand-in over the real schema (supabase/schema.sql), every call as
/// the anon role. Skipped, loudly, otherwise: a skipped suite is not a pass.
final class InteropTests: XCTestCase {
    /// Supabase calls go to the real database; map services stay faked.
    struct Mixed: HTTPTransport {
        let real = URLSessionTransport(); let world: World
        func send(_ r: URLRequest) async throws -> (data: Data, status: Int) {
            r.url!.host == "127.0.0.1" ? try await real.send(r) : try await world.send(r)
        }
    }

    func config() throws -> SupabaseConfig {
        guard let u = ProcessInfo.processInfo.environment["MP_RPC_URL"] else { throw XCTSkip("MP_RPC_URL not set — run bash test/ios-interop.sh") }
        return SupabaseConfig(url: u, key: "anon-key")
    }

    func testClientSpeaksTheRealSchema() async throws {
        let cfg = try config(), t = URLSessionTransport()
        let a = SessionClient(config: cfg, transport: t, store: MemoryStore())
        let b = SessionClient(config: cfg, transport: t, store: MemoryStore())
        let code = try await a.create(name: "Sal", label: "Wicker Park", lat: 41.9088, lon: -87.6796)
        XCTAssertEqual(code.count, 10)
        try await b.join(code: code.uppercased(), name: "Ravi", label: "Hyde Park", lat: 41.7943, lon: -87.5907)

        await a.prefs(cats: ["food", "drinks"], filters: { var f = Filters(); f.travel = .walk; f.noChains = false; return f }())
        await b.vote(key: "node/1", dir: 1)
        let s = try await a.fetch()
        XCTAssertEqual(s.people.map(\.name), ["Sal", "Ravi"])
        XCTAssertEqual(s.people[0].label, "Wicker Park")
        XCTAssertEqual(s.cats, ["food", "drinks"])
        var f = Filters(); f.apply(remote: s.filters)
        XCTAssertEqual(f.travel, .walk); XCTAssertFalse(f.noChains)
        XCTAssertEqual(s.votes["node/1"]?.values.first, 1)

        // The web app's results payload shape, written by Swift and read back.
        let shared = SharedResults(at: 123, people: s.people.map(\.id), together: false, estimated: false, travel: "drive",
            venues: [.init(venue: Venue(key: "node/1", name: "Bow Truss", lat: 41.9, lon: -87.7, town: "Chicago"), costs: [600, 840])])
        let data = try JSONEncoder().encode(shared)
        try await a.share(results: try JSONDecoder().decode(JSONValue.self, from: data))
        let after = try await b.fetch()
        XCTAssertEqual(after.resultsBy, s.people[0].id)
        XCTAssertEqual(after.results?.remapped(onto: s.people.map(\.id)).first?.costs[s.people[1].id], 840)

        do { try await SessionClient(config: cfg, transport: t, store: MemoryStore()).join(code: "ffffffffff", name: "", label: "", lat: nil, lon: nil); XCTFail() }
        catch { XCTAssertEqual(error as? SyncError, .sessionNotFound) }

        await b.leave()
        let left = try await a.fetch()
        XCTAssertEqual(left.people.count, 1)
    }

    func testTheCapIsEightAndTheErrorIsTheContractsString() async throws {
        let cfg = try config(), t = URLSessionTransport()
        let a = SessionClient(config: cfg, transport: t, store: MemoryStore())
        let code = try await a.create(name: "", label: "", lat: nil, lon: nil)
        for i in 0..<7 { try await SessionClient(config: cfg, transport: t, store: MemoryStore()).join(code: code, name: "p\(i)", label: "", lat: nil, lon: nil) }
        do { try await SessionClient(config: cfg, transport: t, store: MemoryStore()).join(code: code, name: "9th", label: "", lat: nil, lon: nil); XCTFail() }
        catch { XCTAssertEqual(error as? SyncError, .sessionFull) }
    }

    func testAWrongKeyIsRefused() async throws {
        let c = SessionClient(config: SupabaseConfig(url: try config().url, key: "wrong"), transport: URLSessionTransport(), store: MemoryStore())
        do { _ = try await c.create(name: "", label: "", lat: nil, lon: nil); XCTFail() }
        catch { guard case SyncError.server = error else { return XCTFail("\(error)") } }
    }

    @MainActor func testTwoAppModelsOnTheRealDatabaseAgree() async throws {
        let cfg = try config(), world = World()
        func phone() -> AppModel {
            AppModel(transport: Mixed(world: world), userAgent: "MidPnt-iOS/test (t@example.com)", supabase: cfg, store: MemoryStore(),
                     rng: SplitMix(state: 1), geocodeInterval: 0)
        }
        let a = phone(); let ap = a.addPerson(name: "Sal")!
        await a.setPlace(ap.id, typed: "Wicker Park"); await a.goLive()
        let b = phone(); let bp = b.addPerson(name: "Ravi")!
        await b.setPlace(bp.id, typed: "Hyde Park")
        await b.join(code: a.liveCode!)
        await b.setPlace(b.me!, typed: "Hyde Park")
        a.apply(remote: try await a.session!.fetch())
        await a.search()
        b.apply(remote: try await b.session!.fetch())
        XCTAssertFalse(a.results.isEmpty)
        XCTAssertEqual(b.results.map(\.venue.key), a.results.map(\.venue.key))
        let top = a.results[0].venue.key
        await a.vote(top, 1); await b.vote(top, 1)
        a.apply(remote: try await a.session!.fetch())
        XCTAssertEqual(a.winner?.venue.key, top)
    }
}
