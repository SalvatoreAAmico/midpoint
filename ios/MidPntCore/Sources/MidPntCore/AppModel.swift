import Foundation
import Observation

/// Everything the screens read, and everything they ask for. One of these per
/// screen group, not a global `state`: app.js is one mutable object, which is
/// fine in 2,300 lines of JS and a trap in SwiftUI. The invariant that matters
/// survives the move — costs belong to people by id, never by position.
///
/// All logic lives here (and below) so it is tested on Linux; the SwiftUI
/// layer only binds and calls.
@MainActor @Observable
public final class AppModel {
    // MARK: what the screens show
    public var people: [Person] = []
    public var cats: [String] = ["coffee"]
    public var lucky = false
    public var filters = Filters()
    public var votes: Votes = [:]
    public var me: String?
    public private(set) var results: [ScoredVenue] = []
    public private(set) var center: Coordinate?
    public private(set) var together = false
    public private(set) var estimated = false
    public private(set) var searching = false
    public private(set) var resultsAt: Double = 0
    /// Calm information ("12 spots, ranked by real drive time"). Never red.
    public var note = ""
    /// Something broken. Declining to share a location is not this.
    public var liveError = ""
    public private(set) var groups: [SavedGroup] = []
    public var mapsApp: Maps.App
    public private(set) var liveCode: String?

    public var isLive: Bool { liveCode != nil }
    public var located: [Person] { people.filter { $0.coordinate != nil } }
    public var winner: ScoredVenue? { VoteBook.winner(votes: votes, people: people, results: results) }
    public func tally(_ key: String) -> (up: Int, down: Int) { VoteBook.tally(votes, key) }
    public func isVetoed(_ key: String) -> Bool { VoteBook.isVetoed(votes, key) }
    public var shareURL: URL? { liveCode.map(Invite.shareURL(code:)) }
    public var visibleResults: [ScoredVenue] { results }

    // MARK: collaborators
    let overpass: OverpassClient
    let osrm: OSRM
    let nominatim: Nominatim
    let session: SessionClient?
    let store: KeyValueStore
    var poller: SessionPoller?
    private var rng: any RandomNumberGenerator
    private let clock: @Sendable () -> Date
    private var nudgedVotes = false

    public init(transport: HTTPTransport, userAgent: String, supabase: SupabaseConfig?, store: KeyValueStore,
                rng: any RandomNumberGenerator = SystemRandomNumberGenerator(),
                clock: @escaping @Sendable () -> Date = { Date() },
                geocodeInterval: TimeInterval = 1.0) {
        overpass = OverpassClient(transport: transport)
        osrm = OSRM(transport: transport)
        nominatim = Nominatim(transport: transport, userAgent: userAgent, minInterval: geocodeInterval)
        session = supabase.flatMap { $0.configured ? SessionClient(config: $0, transport: transport, store: store) : nil }
        self.store = store; self.rng = rng; self.clock = clock
        mapsApp = store.string(forKey: StoreKey.maps).flatMap(Maps.App.init(rawValue:)) ?? .apple
        groups = GroupStore.load(store)
    }

    public var liveAvailable: Bool { session != nil }

    // MARK: people

    @discardableResult
    public func addPerson(name: String = "") -> Person? {
        guard people.count < Limits.maxPeople else { note = "That's \(Limits.maxPeople) people — the most we can find a fair spot for."; return nil }
        let id = UUID().uuidString.lowercased()
        let p = Person(id: id, name: name.isEmpty ? (people.isEmpty ? (store.string(forKey: StoreKey.name) ?? "") : "") : name)
        people.append(p)
        if me == nil { me = id }
        return p
    }

    public func removePerson(_ id: String) {
        people.removeAll { $0.id == id }
        votes = votes.compactMapValues { var v = $0; v[id] = nil; return v.isEmpty ? nil : v }
        if me == id { me = people.first?.id }
    }

    public func setName(_ id: String, _ name: String) async {
        guard let i = people.firstIndex(where: { $0.id == id }) else { return }
        people[i].name = name; people[i].nameAuto = false
        if id == me, !name.trimmingCharacters(in: .whitespaces).isEmpty { store.set(name, forKey: StoreKey.name) }
        await pushMe()
    }

    public func setFlex(_ id: String, _ flex: Bool) {
        if let i = people.firstIndex(where: { $0.id == id }) { people[i].flex = flex }
    }

    /// A typed place. nil = no match; the note says what to try, and is not an error.
    public func setPlace(_ id: String, typed query: String) async {
        guard let i = people.firstIndex(where: { $0.id == id }) else { return }
        people[i].locating = true
        defer { if let j = people.firstIndex(where: { $0.id == id }) { people[j].locating = false } }
        do {
            guard let place = try await nominatim.geocode(query) else {
                note = "No match for “\(query)” — try adding the city."; return
            }
            apply(id, lat: place.lat, lon: place.lon, label: place.label)
            await pushMe(ifMe: id)
        } catch { note = "Couldn't look that up just now — try again in a moment." }
    }

    /// A device fix from CoreLocation (the app target adapts it to plain doubles).
    public func setLocation(_ id: String, lat: Double, lon: Double) async {
        apply(id, lat: lat, lon: lon, label: "")
        if let i = people.firstIndex(where: { $0.id == id }) { people[i].locating = true }
        let label = (try? await nominatim.reverse(lat: lat, lon: lon)) ?? ""
        if let i = people.firstIndex(where: { $0.id == id }) {
            people[i].locating = false
            people[i].label = label.isEmpty ? "Shared location" : label
        }
        await pushMe(ifMe: id)
    }

    private func apply(_ id: String, lat: Double, lon: Double, label: String) {
        guard let i = people.firstIndex(where: { $0.id == id }) else { return }
        people[i].lat = lat; people[i].lon = lon; people[i].label = label
    }

    private func pushMe(ifMe id: String? = nil) async {
        guard isLive, let me, id == nil || id == me, let p = people.first(where: { $0.id == me }), let session else { return }
        try? await session.push(name: p.name, label: p.label, lat: p.lat, lon: p.lon)
    }

    // MARK: categories and filters

    public func toggleCat(_ id: String) async {
        cats = cats.contains(id) ? cats.filter { $0 != id } : cats + [id]
        if cats.isEmpty { cats = [id] }
        lucky = false                       // an explicit choice ends lucky mode
        await pushPrefs()
    }

    public func setFilters(_ f: Filters) async { filters = f; await pushPrefs() }

    func pushPrefs() async { if isLive { await session?.prefs(cats: cats, filters: filters) } }

    /// Choosing a meal chooses a time — but only when no day is picked yet, so
    /// it never overrides a deliberate "Saturday at 2pm". Returns whether it did,
    /// because a filter that changes itself silently is the kind of thing you
    /// notice three searches later and cannot explain.
    @discardableResult
    public func applyMealTime(_ id: String, weekday: Int) -> Bool {
        guard let meal = Catalog.shared[id]?.meal, filters.when.isEmpty else { return false }
        filters.when = String(weekday); filters.whenTime = meal
        note = "Checking what's open at \(meal). Change the day or time if you meant another day."
        return true
    }

    public func rollLucky() async {
        cats = Lucky.roll(current: cats, wasLucky: lucky, using: &rng)
        lucky = true
        await pushPrefs()
        await search()
    }

    // MARK: search

    public func search() async {
        if searching { return }
        let travellers = located.map { Traveller(id: $0.id, coordinate: $0.coordinate!, flex: $0.flex) }
        // Returning here BEFORE setting `searching` matters: the web app once set
        // it first and returned without clearing it, and every later search
        // silently did nothing ("the app gets hung up").
        guard !travellers.isEmpty else { note = "Add at least one location first."; return }
        searching = true; results = []
        defer { searching = false }

        let walking = filters.travel == .walk
        note = "Searching OpenStreetMap near the midpoint…"
        do {
            let f = Venues.Filter(noChains: filters.noChains, at: whenDate(), maxPrice: filters.maxPrice)
            var out = try await Search.run(located: travellers, cats: cats, travel: filters.travel, filter: f,
                                           overpass: overpass, osrm: osrm)
            center = out.center; together = out.together; estimated = out.estimated
            if out.empty { note = "No matching spots nearby. Try more activity types or a wider group."; return }
            if lucky { out.results = Lucky.shuffleFairest(out.results, using: &rng) }
            results = out.results

            if lucky { note = "Shuffled from the fairest. Re-roll for another." }
            else if out.chainsHidden == -1 { note = "Only chains near this midpoint — showing them anyway." }
            else if out.together { note = "You're all in the same place — \(results.count) spots near you, nearest first." }
            else if out.estimated { note = "\(walking ? "Walking" : "Drive")-time service unavailable — showing distance-based estimates." }
            else { note = "\(results.count) spots, ranked by real \(walking ? "walking" : "drive") time."
                   + (out.chainsHidden > 0 ? " \(out.chainsHidden) chain\(out.chainsHidden > 1 ? "s" : "") hidden." : "") }

            resultsAt = clock().timeIntervalSince1970 * 1000
            if isLive { await share(located: travellers) }
        } catch {
            note = "Search failed: \(error.localizedDescription). Try again in a moment."
        }
    }

    /// The moment to test opening hours against; nil = don't filter by time.
    /// A weekday resolves to its NEXT occurrence, so Friday picked on a Saturday
    /// means the Friday coming.
    func whenDate(calendar: Calendar = .current) -> Date? {
        let w = filters.when
        if w.isEmpty { return nil }
        if w == "now" { return clock() }
        guard let day = Int(w), (0...6).contains(day) else { return nil }
        let parts = filters.whenTime.split(separator: ":").compactMap { Int($0) }
        let now = clock()
        let today = calendar.component(.weekday, from: now) - 1
        let ahead = (day - today + 7) % 7
        let d = calendar.date(byAdding: .day, value: ahead, to: now)!
        return calendar.date(bySettingHour: parts.first ?? 0, minute: parts.count > 1 ? parts[1] : 0, second: 0, of: d)
    }

    private func share(located: [Traveller]) async {
        let payload = SharedResults(
            at: resultsAt, people: located.map(\.id), together: together, estimated: estimated, travel: filters.travel.rawValue,
            venues: results.prefix(Limits.maxVenues).map { v in
                SharedResults.SharedVenue(venue: v.venue, costs: located.map { v.costs[$0.id].map(Geo.jsRound) }) })
        guard let d = try? JSONEncoder().encode(payload), let j = try? JSONDecoder().decode(JSONValue.self, from: d) else { return }
        do { try await session?.share(results: j) }
        catch SyncError.missingFunction { liveError = "Sharing results needs the latest database update (fix-003)." }
        catch { liveError = "Couldn't share this search — check your connection." }
    }

    // MARK: votes

    public func vote(_ key: String, _ dir: Int) async {
        if me == nil { me = people.first?.id }
        guard let me else { return }
        let held = VoteBook.toggle(&votes, key: key, me: me, dir: dir)
        if isLive { await session?.vote(key: key, dir: held) }
    }

    // MARK: saved groups (local; no account, no backend)

    public func saveGroup(named name: String) {
        let auto = Set(people.filter(\.nameAuto).map(\.id))
        let g = SavedGroup.from(name: name.isEmpty ? Names.suggestGroupName(people) : name, people: people, autoNamed: auto)
        guard !g.name.isEmpty, !g.people.isEmpty else { return }
        groups = Array(([g] + groups.filter { $0.name != g.name }).prefix(SavedGroup.maxGroups))
        GroupStore.save(groups, to: store)
    }

    public func deleteGroup(_ id: String) { groups.removeAll { $0.id == id }; GroupStore.save(groups, to: store) }

    /// Ids are regenerated, so a group can be loaded twice or into a session that already has people.
    public func applyGroup(_ g: SavedGroup) {
        for m in g.people where people.count < Limits.maxPeople {
            let id = UUID().uuidString.lowercased()
            people.append(Person(id: id, name: m.name.isEmpty ? Names.codename(id) : m.name, lat: m.lat, lon: m.lon,
                                 label: m.label, flex: m.flex, nameAuto: m.name.isEmpty))
        }
        if me == nil { me = people.first?.id }
    }

    public func setMapsApp(_ a: Maps.App) { mapsApp = a; store.set(a.rawValue, forKey: StoreKey.maps) }
    public func mapsURL(for v: Venue) -> URL { URL(string: Maps.url(name: v.name, lat: v.lat, lon: v.lon, app: mapsApp))! }

    // MARK: links

    /// A tapped invite. A session code joins; a hash state restores a no-backend group.
    public func open(_ invite: Invite) async {
        if let code = invite.sessionCode { await join(code: code) }
        else if let s = invite.state {
            people = s.people; cats = s.cats; lucky = s.lucky; votes = s.votes
            filters.travel = s.travel; filters.when = s.when; filters.whenTime = s.whenTime
            filters.noChains = s.noChains; filters.maxPrice = s.maxPrice
            // A link carries the id of whoever made it. If this device has never been
            // that id, none of the rows is you.
            me = s.hashMe.flatMap { id in s.people.contains { $0.id == id } && store.string(forKey: StoreKey.mine)?.contains(id) == true ? id : nil }
                ?? people.first?.id
        }
    }

    // MARK: live sessions

    /// Called at launch. If this device was in a session it is still in, rejoin as the same
    /// person — relaunching must not create a second copy of you.
    public func resumeIfNeeded() async {
        guard !isLive, session != nil, let raw = store.string(forKey: StoreKey.session),
              case .object(let o)? = try? JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8)),
              let code = o["code"]?.string else { return }
        await join(code: code)
        // Not recognised any more (left, or expired): forget it, so we stop asking.
        if !isLive { store.set(nil, forKey: StoreKey.session) }
    }

    /// A saved group tapped from the Home Screen widget.
    @discardableResult
    public func openGroup(id: String) -> Bool {
        guard let g = groups.first(where: { $0.id == id }) else { return false }
        applyGroup(g); return true
    }

    /// What the Lock Screen / Dynamic Island shows once the group has decided.
    public struct MeetupSummary: Equatable, Sendable {
        public var venueKey: String, name: String, town: String
        public var minutes: Int?              // MY journey; nil if I have no time (no location)
        public var estimated: Bool
        public var lat: Double, lon: Double
    }
    public var meetupSummary: MeetupSummary? {
        guard let w = winner else { return nil }
        let mine = me.flatMap { w.costs[$0] }
        return MeetupSummary(venueKey: w.venue.key, name: w.venue.name, town: w.venue.town,
                             minutes: mine.map { max(1, Int(Geo.jsRound($0 / 60))) }, estimated: estimated,
                             lat: w.venue.lat, lon: w.venue.lon)
    }

    public func goLive() async {
        guard let session else { liveError = SyncError.notConfigured.userMessage; return }
        if me == nil { addPerson() }
        guard let p = people.first(where: { $0.id == me }) ?? people.first else { return }
        do {
            let code = try await session.create(name: p.name, label: p.label, lat: p.lat, lon: p.lon)
            await adoptIdentity(code: code)
            await pushPrefs()
        } catch let e as SyncError { liveError = e.userMessage } catch { liveError = "Couldn't start a session — check your connection." }
    }

    public func join(code: String) async {
        guard let session else { liveError = SyncError.notConfigured.userMessage; return }
        let c = code.trimmingCharacters(in: .whitespaces).lowercased()
        do {
            // Already you in this session? Resume rather than join again, or relaunching
            // from a link fills the session with copies of one person.
            if let state = try await session.resume(code: c) {
                await adoptIdentity(code: c); apply(remote: state)
            } else {
                let mine = people.first(where: { $0.id == me })
                try await session.join(code: c, name: mine?.name ?? store.string(forKey: StoreKey.name) ?? "",
                                       label: mine?.label ?? "", lat: mine?.lat, lon: mine?.lon)
                await adoptIdentity(code: c)
            }
        } catch let e as SyncError { liveError = e.userMessage } catch { liveError = "Couldn't join — check your connection." }
    }

    private func adoptIdentity(code: String) async {
        guard let session, let id = await session.me else { return }
        liveCode = await session.code ?? code
        // The server owns the roster now; our local row becomes our server id.
        if let i = people.firstIndex(where: { $0.id == me }) { people[i].id = id } else { people.insert(Person(id: id), at: 0) }
        me = id
        liveError = ""
        var mineIDs = store.string(forKey: StoreKey.mine) ?? ""
        if !mineIDs.contains(id) { mineIDs += (mineIDs.isEmpty ? "" : ",") + id; store.set(mineIDs, forKey: StoreKey.mine) }
        let poller = SessionPoller(client: session) { [weak self] event in
            await MainActor.run { self?.handle(event) }
        }
        self.poller = poller
        await poller.start()
    }

    private func handle(_ e: SessionPoller.Event) {
        switch e {
        case .state(let s): apply(remote: s)
        case .ended(let err):
            liveError = err.userMessage; liveCode = nil
            Task { await session?.detach() }
        }
    }

    public func leave() async {
        await poller?.stop(); poller = nil
        await session?.leave()
        liveCode = nil; liveError = ""
    }

    /// `scenePhase != .active` replaces visibilitychange.
    public func setActive(_ active: Bool) async { await poller?.setPaused(!active) }

    /// In live mode the server owns the roster, so a poll replaces `people`
    /// (carrying forward only what is local).
    public func apply(remote: RemoteState) {
        liveError = ""
        // Sessions that predate a fix store the placeholder as a genuine label.
        func clean(_ l: String) -> String { l == "Locating…" ? "" : l }
        let mine = me
        people = remote.people.prefix(Limits.maxPeople).map { rp in
            let prev = people.first { $0.id == rp.id }
            let isMe = rp.id == mine
            let keepName = isMe && !(prev?.name ?? "").isEmpty && rp.name.isEmpty        // our push is in flight
            let locating = isMe ? (prev?.locating ?? false) : false
            var label = locating ? (prev?.label ?? "") : (clean(rp.label).isEmpty ? (prev?.label ?? "") : clean(rp.label))
            if label.isEmpty && rp.lat != nil { label = "Shared location" }
            return Person(id: rp.id, name: keepName ? prev!.name : (rp.name.isEmpty ? Names.codename(rp.id) : rp.name),
                          lat: rp.lat, lon: rp.lon, label: label, flex: prev?.flex ?? false,
                          nameAuto: prev?.nameAuto ?? rp.name.isEmpty, locating: locating)
        }
        // Two devices of one person both recall the same saved name; whoever did
        // not type it this session gives way to a placeholder.
        if let i = people.firstIndex(where: { $0.id == mine }), people[i].nameAuto, !people[i].name.isEmpty,
           people.contains(where: { $0.id != mine && $0.name.lowercased() == people[i].name.lowercased() }) {
            people[i].name = Names.codename(people[i].id)
            Task { await pushMe() }
        }
        votes = remote.votes
        let catsBefore = cats
        if !remote.cats.isEmpty { cats = remote.cats }
        let changed = filters.apply(remote: remote.filters) || cats != catsBefore

        // Someone else searched: show their list rather than running our own. Also take
        // back our own when we hold nothing — after a relaunch the session still has it.
        let mineToReclaim = remote.resultsBy == me && results.isEmpty
        var adopted = false
        if (remote.resultsBy != me || mineToReclaim), let r = remote.results, adopt(r) { adopted = true }

        // A thumbs-up from another phone should put the list on screen; if there is no
        // published search to adopt, say so — once, not every four seconds.
        if results.isEmpty && !remote.votes.isEmpty && !adopted {
            if !nudgedVotes { nudgedVotes = true; note = "Someone in the session liked a spot. Tap Find meetup spots to see it." }
        } else if !results.isEmpty { nudgedVotes = false }

        if changed && !results.isEmpty && !searching && !adopted {
            note = "Search settings changed by someone in the session — updating…"
            Task { await search() }
        }
    }

    func adopt(_ r: SharedResults) -> Bool {
        guard !r.venues.isEmpty else { return false }
        if let at = r.at, resultsAt != 0, at <= resultsAt { return false }
        results = r.remapped(onto: people.map(\.id))
        together = r.together; estimated = r.estimated
        resultsAt = r.at ?? clock().timeIntervalSince1970 * 1000
        if let t = r.travel, filters.travel.rawValue != t { filters.travel = t == "walk" ? .walk : .drive }
        center = Geo.centroid(located.compactMap(\.coordinate))
        return !results.isEmpty
    }
}
