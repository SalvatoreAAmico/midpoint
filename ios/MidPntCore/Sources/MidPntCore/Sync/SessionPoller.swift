import Foundation

/// Polls `mp_state`. Realtime would need table read access the security model
/// forbids, so this buys privacy with a few seconds of latency. The free tier
/// cannot bill you — it throttles — but a runaway poll could still burn the
/// month's egress, so the client caps itself four ways:
///   1. a hard floor on the interval, so no bug can poll faster than this
///   2. polling pauses entirely while the app is not in the foreground
///   3. only one request is ever in flight
///   4. failures back off, and a session auto-ends after `maxSessionSeconds`
public actor SessionPoller {
    public static let pollSeconds = 4.0
    public static let floorSeconds = 2.0
    public static let maxBackoffSeconds = 60.0
    public static let maxSessionSeconds = 2.0 * 60 * 60
    public static let maxFailures = 5

    public enum Event: Sendable {
        case state(RemoteState)
        /// The poller has stopped; show this and offer to start again.
        case ended(SyncError)
    }

    private let client: SessionClient
    private let now: @Sendable () -> Date
    private let sleep: @Sendable (Double) async throws -> Void
    private let onEvent: @Sendable (Event) async -> Void

    private var task: Task<Void, Never>?
    private var inFlight = false
    private(set) var failures = 0
    private var startedAt: Date
    public private(set) var paused = false

    public init(client: SessionClient,
                now: @escaping @Sendable () -> Date = { Date() },
                sleep: @escaping @Sendable (Double) async throws -> Void = { try await Task.sleep(nanoseconds: UInt64($0 * 1e9)) },
                onEvent: @escaping @Sendable (Event) async -> Void) {
        self.client = client; self.now = now; self.sleep = sleep; self.onEvent = onEvent
        startedAt = now()
    }

    /// Seconds to wait after the latest poll. 4 s normally; after n failures
    /// 4 s × 2ⁿ, capped at a minute; never below the floor.
    public static func interval(afterFailures n: Int) -> Double {
        let base = n == 0 ? pollSeconds : min(pollSeconds * pow(2, Double(n)), maxBackoffSeconds)
        return max(floorSeconds, base)
    }

    public func start() {
        stop()
        startedAt = now(); failures = 0
        if !paused { loop() }
    }

    public func stop() { task?.cancel(); task = nil }

    /// `scenePhase != .active` -> true. A backgrounded app costs requests for
    /// updates nobody is looking at, so stop entirely and refresh once on return.
    public func setPaused(_ p: Bool) async {
        guard p != paused else { return }
        paused = p
        if p { stop() } else if await client.live { loop() }
    }

    private func loop() {
        task?.cancel()
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.poll()
                if Task.isCancelled { return }
                let wait = Self.interval(afterFailures: await self.failures)
                do { try await self.sleep(wait) } catch { return }
            }
        }
    }

    /// One poll. Exposed so tests can drive it without timers.
    public func poll() async {
        guard await client.live, !paused else { return }
        // Never stack requests: a slow network must not queue a backlog.
        guard !inFlight else { return }

        if now().timeIntervalSince(startedAt) > Self.maxSessionSeconds {
            stop(); await client.leave()
            await onEvent(.ended(.server("Session ended after 2 hours. Tap Go live to start a new one.")))
            return
        }
        inFlight = true
        defer { inFlight = false }
        do {
            let s = try await client.fetch()
            failures = 0
            await onEvent(.state(s))
        } catch {
            // Tolerate a few blips (tunnel, sleeping phone) before giving up.
            failures += 1
            if failures >= Self.maxFailures {
                stop()
                await onEvent(.ended((error as? SyncError) ?? .server("Lost contact with the session.")))
            }
        }
    }
}
