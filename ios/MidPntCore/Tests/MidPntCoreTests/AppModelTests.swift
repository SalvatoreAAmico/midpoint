import XCTest
@testable import MidPntCore

final class AppModelTests: XCTestCase {
    /// Deliver one poll to a phone by hand: deterministic, no timers.
    @MainActor func sync(_ m: AppModel, _ w: World) async throws {
        let s = try await m.session!.fetch()
        m.apply(remote: s)
    }

    @MainActor func soloPhone(_ w: World, at place: String = "Wicker Park") async -> AppModel {
        let m = makePhone(w)
        let p = m.addPerson(name: "Sal")!
        await m.setPlace(p.id, typed: place)
        return m
    }

    @MainActor func testSoloSearchRanksByRealTimeInTwoCalls() async {
        let w = World()
        let m = makePhone(w)
        let a = m.addPerson(name: "Sal")!, b = m.addPerson(name: "Ravi")!
        await m.setPlace(a.id, typed: "Wicker Park"); await m.setPlace(b.id, typed: "Hyde Park")
        let before = (w.count("overpass"), w.count("router.project-osrm"))
        await m.search()
        XCTAssertEqual(w.count("overpass") - before.0, 1); XCTAssertEqual(w.count("router.project-osrm") - before.1, 1)
        XCTAssertEqual(m.results.count, 14)
        XCTAssertFalse(m.estimated)
        XCTAssertTrue(m.note.contains("ranked by real drive time"), m.note)
        XCTAssertEqual(m.results.map(\.score), m.results.map(\.score).sorted())
        XCTAssertEqual(Set(m.results[0].costs.keys), [a.id, b.id])
    }

    @MainActor func testNoLocationIsAnInstructionNotAnErrorAndNeverWedgesSearch() async {
        let w = World()
        let m = makePhone(w); m.addPerson(name: "Sal")
        await m.search()
        XCTAssertEqual(m.note, "Add at least one location first.")
        XCTAssertFalse(m.searching, "the flag must not stick — that was the hang")
        let p = m.people[0]
        await m.setPlace(p.id, typed: "Wicker Park")
        await m.search()
        XCTAssertFalse(m.results.isEmpty, "a later search still runs")
    }

    @MainActor func testUnknownPlaceSaysWhatToTry() async {
        let w = World(); let m = makePhone(w); let p = m.addPerson(name: "Sal")!
        await m.setPlace(p.id, typed: "zzzzz")
        XCTAssertEqual(m.note, "No match for “zzzzz” — try adding the city.")
        XCTAssertEqual(m.liveError, "")
        XCTAssertNil(m.people[0].lat)
    }

    @MainActor func testRoutingOutageDegradesToMarkedEstimates() async {
        let w = World(); w.routingDown = true
        let m = await soloPhone(w); await m.search()
        XCTAssertTrue(m.estimated); XCTAssertFalse(m.results.isEmpty)
        XCTAssertTrue(m.note.contains("distance-based estimates"))
    }

    @MainActor func testEightPeopleIsTheCap() async {
        let m = makePhone(World())
        for _ in 0..<8 { XCTAssertNotNil(m.addPerson()) }
        XCTAssertNil(m.addPerson()); XCTAssertEqual(m.people.count, 8)
    }

    // The phase-3 acceptance test: a mixed session agrees on roster, results order, shortlist and winner.
    @MainActor func testTwoPhonesAgreeOnRosterResultsShortlistAndWinner() async throws {
        let w = World()
        let a = await soloPhone(w, at: "Wicker Park")
        await a.goLive()
        let code = try XCTUnwrap(a.liveCode)

        let b = makePhone(w); let bp = b.addPerson(name: "Ravi")!
        await b.setPlace(bp.id, typed: "Hyde Park")
        await b.open(Invite.parse(Invite.shareURL(code: code))!)
        XCTAssertEqual(b.liveCode, code)

        try await sync(a, w); try await sync(b, w)
        XCTAssertEqual(a.people.map(\.name).sorted(), ["Ravi", "Sal"])
        XCTAssertEqual(b.people.map(\.id).sorted(), a.people.map(\.id).sorted())

        // B's location reached the server only if join carried it; push anyway like the app does.
        await b.setPlace(b.me!, typed: "Hyde Park")
        try await sync(a, w)
        XCTAssertEqual(a.located.count, 2)

        await a.search()
        let order = a.results.map(\.venue.key)
        XCTAssertFalse(order.isEmpty)
        XCTAssertEqual(w.count("overpass"), 1, "one search for the whole session")

        try await sync(b, w)
        XCTAssertEqual(b.results.map(\.venue.key), order, "B adopts A's list, same order")
        for (x, y) in zip(a.results, b.results) {
            for id in a.people.map(\.id) { XCTAssertEqual(x.costs[id] ?? -1, y.costs[id] ?? -1, accuracy: 0.5, "rounded to whole seconds on the wire") }
        }
        XCTAssertEqual(w.count("overpass"), 1, "B did not search again")

        // Shortlist and winner.
        let top = order[0]
        await a.vote(top, 1); try await sync(b, w)
        XCTAssertEqual(b.tally(top).up, 1)
        XCTAssertNil(b.winner, "not everyone has voted")
        await b.vote(top, 1); try await sync(a, w)
        XCTAssertEqual(a.winner?.venue.key, top); try await sync(b, w)
        XCTAssertEqual(b.winner?.venue.key, top)
        await b.vote(top, -1); try await sync(a, w)
        XCTAssertNil(a.winner, "one objection stops the app declaring a winner")
    }

    @MainActor func testAJoinerWithNoLocationNeverBorrowsSomeoneElsesTime() async throws {
        let w = World()
        let a = await soloPhone(w); await a.goLive()
        await a.search()
        let late = makePhone(w); late.addPerson(name: "Late")
        await late.join(code: a.liveCode!)
        try await sync(a, w); try await sync(late, w)
        let lateID = late.me!
        XCTAssertEqual(late.results.count, a.results.count)
        for v in late.results {
            XCTAssertNil(v.costs[lateID], "no location, no time")
            XCTAssertEqual(v.costs.count, 1)
            XCTAssertTrue(v.mean.isFinite && v.spread.isFinite)
        }
    }

    @MainActor func testRelaunchingFromALinkDoesNotCreateASecondYou() async throws {
        let w = World(), store = MemoryStore()
        let first = makePhone(w, store: store); first.addPerson(name: "Sal")
        await first.goLive()
        let code = first.liveCode!
        let relaunched = makePhone(w, store: store)         // new process, same device, same link
        await relaunched.open(Invite.parse(Invite.shareURL(code: code))!)
        let s = try await relaunched.session!.fetch()
        XCTAssertEqual(s.people.count, 1, "still one of you")
        XCTAssertEqual(relaunched.me, first.me)
        XCTAssertEqual(w.count("mp_join"), 0)
    }

    @MainActor func testFiltersAndCategoriesTravelWithTheSession() async throws {
        let w = World()
        let a = await soloPhone(w); await a.goLive()
        let b = makePhone(w); b.addPerson(name: "Ravi"); await b.join(code: a.liveCode!)
        await a.toggleCat("food")
        var f = a.filters; f.travel = .walk; f.noChains = false; await a.setFilters(f)
        try await sync(b, w)
        XCTAssertEqual(b.cats, ["coffee", "food"]); XCTAssertEqual(b.filters.travel, .walk); XCTAssertFalse(b.filters.noChains)
    }

    @MainActor func testTheSearchAfterAFilterChangeReusesNothingStaleAndIsSharedOnce() async throws {
        let w = World()
        let a = await soloPhone(w); await a.goLive(); await a.search()
        let b = makePhone(w); b.addPerson(name: "Ravi"); await b.join(code: a.liveCode!)
        try await sync(b, w)
        XCTAssertFalse(b.results.isEmpty)
        let again = b.results.map(\.venue.key)
        try await sync(b, w)                                  // the same poll twice adopts nothing new
        XCTAssertEqual(b.results.map(\.venue.key), again)
    }

    @MainActor func testBackgroundingPausesPollingAndForegroundResumes() async throws {
        let w = World()
        let a = await soloPhone(w); await a.goLive()
        await a.setActive(false)
        let paused = await a.poller!.paused
        XCTAssertTrue(paused)
        await a.setActive(true)
        let resumed = await a.poller!.paused
        XCTAssertFalse(resumed)
        await a.leave()
    }

    @MainActor func testLeavingForgetsEverything() async {
        let w = World(), store = MemoryStore()
        let a = makePhone(w, store: store); a.addPerson(name: "Sal"); await a.goLive()
        await a.leave()
        XCTAssertNil(a.liveCode); XCTAssertNil(store.string(forKey: StoreKey.session))
    }

    @MainActor func testAnOutageDoesNotPaintTheScreenRedForever() async throws {
        let w = World()
        let a = await soloPhone(w); await a.goLive()
        w.failSupabase = true
        await a.vote("node/1", 1)                              // fire-and-forget, must not throw or wedge
        w.failSupabase = false
        try await sync(a, w)
        XCTAssertEqual(a.liveError, "")
    }

    @MainActor func testSavedGroupsRoundTripAndReloadWithFreshIDs() async {
        let store = MemoryStore()
        let m = makePhone(World(), store: store)
        m.addPerson(name: "Sal"); m.addPerson(name: "Ravi")
        m.saveGroup(named: "")
        XCTAssertEqual(m.groups.first?.name, "Sal, Ravi")
        let fresh = makePhone(World(), store: store)
        XCTAssertEqual(fresh.groups.count, 1)
        fresh.applyGroup(fresh.groups[0]); fresh.applyGroup(fresh.groups[0])
        XCTAssertEqual(fresh.people.count, 4)
        XCTAssertEqual(Set(fresh.people.map(\.id)).count, 4, "loading twice must not collide")
    }

    @MainActor func testRememberedNameFillsTheFirstRow() async {
        let s = MemoryStore(); s.set("Sal", forKey: StoreKey.name)
        XCTAssertEqual(makePhone(World(), store: s).addPerson()?.name, "Sal")
    }

    @MainActor func testMealPicksATimeOnlyWhenNoneChosen() async {
        let m = makePhone(World())
        XCTAssertTrue(m.applyMealTime("dinner", weekday: 3)); XCTAssertEqual(m.filters.whenTime, "19:00"); XCTAssertEqual(m.filters.when, "3")
        XCTAssertFalse(m.applyMealTime("breakfast", weekday: 3), "never overrides a deliberate choice")
        XCTAssertEqual(m.filters.whenTime, "19:00")
        XCTAssertFalse(makePhone(World()).applyMealTime("coffee", weekday: 3))
    }

    @MainActor func testLuckyShufflesWithinTheFairestAndSharesLikeAnySearch() async {
        let w = World(); let m = await soloPhone(w)
        await m.rollLucky()
        XCTAssertTrue(m.lucky); XCTAssertEqual(m.cats.count, Limits.luckyCats)
        await m.toggleCat("coffee"); XCTAssertFalse(m.lucky, "an explicit choice ends lucky mode")
    }

    @MainActor func testOpeningHoursFilterUsesTheNextOccurrenceOfTheDay() async {
        let m = makePhone(World(), clock: { Date(timeIntervalSince1970: 1_791_000_000) })   // a fixed Saturday-ish moment
        var f = Filters(); f.when = "0"; f.whenTime = "10:30"; m.filters = f
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        let d = m.whenDate(calendar: cal)!
        XCTAssertEqual(cal.component(.weekday, from: d), 1, "Sunday")
        XCTAssertEqual(cal.component(.hour, from: d), 10); XCTAssertEqual(cal.component(.minute, from: d), 30)
        XCTAssertGreaterThanOrEqual(d, Date(timeIntervalSince1970: 1_791_000_000).addingTimeInterval(-86_400))
        f.when = ""; m.filters = f; XCTAssertNil(m.whenDate(calendar: cal))
    }

    @MainActor func testPickingASessionFromAHashLinkRestoresAGroupWithoutABackend() async {
        let payload = #"{"p":[["a","Sal",41.9088,-87.6796,"Wicker Park",0],["b","Ravi",41.7943,-87.5907,"",1]],"c":["food"],"tv":"walk","n":0}"#
        let hash = Data(payload.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let m = makePhone(World(), supabase: false)
        await m.open(Invite.parse(URL(string: "https://salvatoreaamico.com/midpoint/#\(hash)")!)!)
        XCTAssertEqual(m.people.map(\.name), ["Sal", "Ravi"]); XCTAssertEqual(m.cats, ["food"])
        XCTAssertEqual(m.filters.travel, .walk); XCTAssertFalse(m.filters.noChains); XCTAssertTrue(m.people[1].flex)
        XCTAssertFalse(m.liveAvailable)
        await m.goLive()
        XCTAssertEqual(m.liveError, "Live sessions are not set up in this build.")
    }

    @MainActor func testLaunchResumesTheSessionYouWereIn() async throws {
        let w = World(), store = MemoryStore()
        let first = makePhone(w, store: store); first.addPerson(name: "Sal"); await first.goLive()
        let relaunched = makePhone(w, store: store)
        await relaunched.resumeIfNeeded()
        XCTAssertEqual(relaunched.liveCode, first.liveCode)
        XCTAssertEqual(relaunched.me, first.me)
        XCTAssertEqual(w.count("mp_join"), 0)
        // Ended while the app was closed: forgotten, not retried forever.
        await first.leave()
        let later = makePhone(w, store: store)
        await later.resumeIfNeeded()
        XCTAssertNil(later.liveCode); XCTAssertNil(store.string(forKey: StoreKey.session))
    }

    @MainActor func testWidgetTapOpensTheGroup() async {
        let store = MemoryStore()
        let m = makePhone(World(), store: store); m.addPerson(name: "Sal"); m.saveGroup(named: "Crew")
        let fresh = makePhone(World(), store: store)
        XCTAssertFalse(fresh.openGroup(id: "nope"))
        XCTAssertTrue(fresh.openGroup(id: fresh.groups[0].id))
        XCTAssertEqual(fresh.people.map(\.name), ["Sal"])
    }

    @MainActor func testTheLockScreenSummaryIsMyJourneyToTheWinner() async throws {
        let w = World()
        let a = await soloPhone(w, at: "Wicker Park"); await a.goLive()
        let b = makePhone(w); b.addPerson(name: "Ravi"); await b.join(code: a.liveCode!)
        await b.setPlace(b.me!, typed: "Hyde Park")
        try await sync(a, w); await a.search(); try await sync(b, w)
        XCTAssertNil(a.meetupSummary)
        let top = a.results[0].venue.key
        await a.vote(top, 1); await b.vote(top, 1); try await sync(a, w)
        let s = try XCTUnwrap(a.meetupSummary)
        XCTAssertEqual(s.venueKey, top)
        XCTAssertEqual(s.minutes, max(1, Int((a.results[0].costs[a.me!]! / 60).rounded())))
        XCTAssertFalse(s.estimated)
    }
}
