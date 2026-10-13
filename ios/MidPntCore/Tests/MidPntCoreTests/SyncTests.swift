import XCTest
@testable import MidPntCore

final class SyncTests: XCTestCase {
    func client(_ w: World, store: KeyValueStore = MemoryStore()) -> SessionClient {
        SessionClient(config: World.supabase, transport: w, store: store)
    }

    func testCreateJoinStateVoteLeave() async throws {
        let w = World()
        let a = client(w), b = client(w)
        let code = try await a.create(name: "Sal", label: "Wicker Park", lat: 41.9, lon: -87.7)
        XCTAssertEqual(code.count, 10)
        try await b.join(code: " \(code.uppercased()) ", name: "Ravi", label: "", lat: nil, lon: nil)   // trimmed and lowercased
        var s = try await a.fetch()
        XCTAssertEqual(s.people.map(\.name), ["Sal", "Ravi"])
        XCTAssertNil(s.people[1].lat, "in the session, no location shared yet")
        await b.vote(key: "node/1", dir: 1)
        s = try await a.fetch()
        XCTAssertEqual(s.votes["node/1"]?.count, 1)
        await b.vote(key: "node/1", dir: 0)
        s = try await a.fetch()
        XCTAssertTrue(s.votes.isEmpty)
        await b.leave()
        s = try await a.fetch()
        XCTAssertEqual(s.people.count, 1)
        let live = await b.live
        XCTAssertFalse(live)
    }

    func testEveryRequestCarriesTheKeyAndNothingElseSecret() async throws {
        let w = World()
        _ = try await client(w).create(name: "S", label: "", lat: nil, lon: nil)     // World rejects a missing/incorrect key with 401
        XCTAssertEqual(w.count("supabase/mp_create"), 1)
    }

    func testErrorsLeadWithTheFix() async throws {
        let w = World()
        let a = client(w)
        do { try await a.join(code: "nope", name: "", label: "", lat: nil, lon: nil); XCTFail() }
        catch { XCTAssertEqual(error as? SyncError, .sessionNotFound); XCTAssertEqual((error as? SyncError)?.userMessage, "That session has expired or does not exist.") }
        let code = try await a.create(name: "", label: "", lat: nil, lon: nil)
        for i in 0..<7 { try await client(w).join(code: code, name: "p\(i)", label: "", lat: nil, lon: nil) }
        do { try await client(w).join(code: code, name: "ninth", label: "", lat: nil, lon: nil); XCTFail() }
        catch { XCTAssertEqual(error as? SyncError, .sessionFull); XCTAssertEqual((error as? SyncError)?.userMessage, "That session already has 8 people.") }
    }

    func testAProjectWithoutTheLabelMigrationStillWorks() async throws {
        let w = World(); w.hasLabelColumn = false
        let a = client(w)
        let code = try await a.create(name: "Sal", label: "Wicker Park", lat: 1, lon: 2)
        try await a.push(name: "Sal", label: "Wicker Park", lat: 3, lon: 4)
        let s = try await a.fetch(code: code)
        XCTAssertEqual(s.people[0].lat, 3)
        let needs = await a.needsMigration
        XCTAssertTrue(needs)
    }

    func testAMissingResultsMigrationIsNamedNotBlamedOnTheNetwork() async throws {
        let w = World(); w.hasResultsFunction = false
        let a = client(w)
        _ = try await a.create(name: "", label: "", lat: nil, lon: nil)
        do { try await a.share(results: .object([:])); XCTFail() }
        catch { guard case SyncError.missingFunction = error else { return XCTFail("\(error)") } }
        let needs = await a.needsResults
        XCTAssertTrue(needs)
    }

    // The duplicate-you-on-relaunch bug: refreshing mid-session must not join again.
    func testResumeRecognisesYouAndNeverJoinsTwice() async throws {
        let w = World(), store = MemoryStore()
        let first = client(w, store: store)
        let code = try await first.create(name: "Sal", label: "", lat: 1, lon: 2)
        let meBefore = await first.me
        let relaunch = client(w, store: store)                      // new process, same device
        let state = try await relaunch.resume(code: code)
        XCTAssertNotNil(state)
        let meAfter = await relaunch.me
        XCTAssertEqual(meAfter, meBefore)
        XCTAssertEqual(state?.people.count, 1)
        XCTAssertEqual(w.count("mp_join"), 0)
        // A different device (empty store) is not you.
        let stranger = try await client(w).resume(code: code)
        XCTAssertNil(stranger)
        // Left: no longer you, even on the same device.
        await relaunch.leave()
        let again = try await client(w, store: store).resume(code: code)
        XCTAssertNil(again)
    }

    func testTheStoredSessionIsTheWebAppsFormat() async throws {
        let w = World(), store = MemoryStore()
        let code = try await client(w, store: store).create(name: "", label: "", lat: nil, lon: nil)
        guard case .object(let o)? = store.string(forKey: "midpoint.session").flatMap({ try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) }) else { return XCTFail() }
        XCTAssertEqual(o["code"]?.string, code); XCTAssertNotNil(o["me"]?.string)
    }

    func testUnconfiguredBuildsFailPolitely() async {
        let c = SessionClient(config: SupabaseConfig(url: "", key: ""), transport: World(), store: MemoryStore())
        do { _ = try await c.create(name: "", label: "", lat: nil, lon: nil); XCTFail() }
        catch { XCTAssertEqual(error as? SyncError, .notConfigured) }
    }

    func testFiltersMergeLikeApplyRemoteFilters() {
        var f = Filters()
        XCTAssertFalse(f.apply(remote: .object([:])))
        XCTAssertFalse(f.apply(remote: nil))
        XCTAssertTrue(f.apply(remote: .object(["travel": .string("walk"), "future": .number(1)])))
        XCTAssertEqual(f.travel, .walk); XCTAssertTrue(f.noChains, "missing keys leave the local value alone")
        XCTAssertFalse(f.apply(remote: .object(["noChains": .string("yes"), "maxPrice": .number(3)])), "wrong types are skipped")
        XCTAssertTrue(f.apply(remote: .object(["travel": .string("teleport")])))
        XCTAssertEqual(f.travel, .drive, "anything but walk reads as drive")
    }
}

final class PollerTests: XCTestCase {
    func testIntervalsAndFloor() {
        XCTAssertEqual(SessionPoller.interval(afterFailures: 0), 4)
        XCTAssertEqual(SessionPoller.interval(afterFailures: 1), 8)
        XCTAssertEqual(SessionPoller.interval(afterFailures: 2), 16)
        XCTAssertEqual(SessionPoller.interval(afterFailures: 4), 60, "capped at a minute")
        XCTAssertEqual(SessionPoller.interval(afterFailures: 10), 60)
        XCTAssertGreaterThanOrEqual(SessionPoller.floorSeconds, 2)
        XCTAssertGreaterThanOrEqual((0...12).map(SessionPoller.interval(afterFailures:)).min()!, SessionPoller.floorSeconds)
    }

    final class Box: @unchecked Sendable {
        private let l = NSLock(); private var _s: [RemoteState] = []; private var _e: [SyncError] = []
        func add(_ e: SessionPoller.Event) { l.withLock { switch e { case .state(let s): _s.append(s); case .ended(let x): _e.append(x) } } }
        var states: Int { l.withLock { _s.count } }; var ended: [SyncError] { l.withLock { _e } }
    }
    final class Clock: @unchecked Sendable { private let l = NSLock(); private var t = Date(); var now: Date { l.withLock { t } }
        func advance(_ s: Double) { l.withLock { t = t.addingTimeInterval(s) } } }

    private func live(_ w: World, clock: Clock) async throws -> (SessionClient, SessionPoller, Box) {
        let c = SessionClient(config: World.supabase, transport: w, store: MemoryStore())
        _ = try await c.create(name: "Sal", label: "", lat: 1, lon: 2)
        let box = Box()
        let p = SessionPoller(client: c, now: { clock.now }, sleep: { _ in try await Task.sleep(nanoseconds: 1_000_000_000_000) }) { box.add($0) }
        return (c, p, box)
    }

    func testPollDeliversStateAndTheLoopIsNotRunningWhilePaused() async throws {
        let w = World(), clock = Clock()
        let (_, p, box) = try await live(w, clock: clock)
        await p.poll(); XCTAssertEqual(box.states, 1)
        await p.setPaused(true)
        await p.poll()
        XCTAssertEqual(box.states, 1, "no polling while the app is in the background")
        XCTAssertEqual(w.count("mp_state"), 1)
    }

    func testFiveFailuresEndItAndSaySo() async throws {
        let w = World(), clock = Clock()
        let (_, p, box) = try await live(w, clock: clock)
        w.failSupabase = true
        for _ in 0..<4 { await p.poll() }
        XCTAssertTrue(box.ended.isEmpty, "a couple of blips are tolerated")
        await p.poll()
        XCTAssertEqual(box.ended.count, 1)
        // Recovery resets the count.
        let w2 = World(); let (_, p2, box2) = try await live(w2, clock: clock)
        w2.failSupabase = true; for _ in 0..<3 { await p2.poll() }
        w2.failSupabase = false; await p2.poll()
        w2.failSupabase = true; for _ in 0..<3 { await p2.poll() }
        XCTAssertTrue(box2.ended.isEmpty)
    }

    func testASessionEndsItselfAfterTwoHours() async throws {
        let w = World(), clock = Clock()
        let (c, p, box) = try await live(w, clock: clock)
        await p.start(); await p.stop()
        clock.advance(2 * 3600 + 1)
        await p.poll()
        XCTAssertEqual(box.ended.count, 1)
        let l = await c.live
        XCTAssertFalse(l, "and it leaves, so the session is not left holding a ghost")
    }

    func testOnlyOneRequestInFlight() async throws {
        let w = World(), clock = Clock()
        let (_, p, _) = try await live(w, clock: clock)
        w.latencyNs = 150_000_000          // a slow network: the first poll is still out when the rest arrive
        await withTaskGroup(of: Void.self) { g in for _ in 0..<20 { g.addTask { await p.poll() } } }
        // Actor re-entrancy lets a second poll start while the first awaits, so the guard has to hold.
        XCTAssertEqual(w.count("mp_state"), 1, "a slow network must not queue a backlog")
    }
}
