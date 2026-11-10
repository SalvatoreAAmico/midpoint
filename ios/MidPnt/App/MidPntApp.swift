import SwiftUI
import WidgetKit
import MidPntCore

@main
struct MidPntApp: App {
    @State private var model = AppEnvironment.makeModel()
    @State private var activity = MeetupActivityController()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .task { await model.resumeIfNeeded() }
                // Universal Links (https://salvatoreaamico.com/midpoint/?s=…) and the widget's midpnt:// links.
                .onOpenURL { url in Task { await handle(url) } }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { act in
                    if let url = act.webpageURL { Task { await handle(url) } }
                }
                // scenePhase replaces visibilitychange: no polling while backgrounded.
                .onChange(of: phase) { _, p in Task { await model.setActive(p == .active) } }
                .onChange(of: model.meetupSummary) { _, s in Task { await activity.update(s) } }
                // The Home Screen widget reads the same saved groups.
                .onChange(of: model.groups) { _, _ in WidgetCenter.shared.reloadAllTimelines() }
                .onChange(of: model.isLive) { _, live in if !live { Task { await activity.update(nil) } } }
        }
    }

    private func handle(_ url: URL) async {
        if url.scheme == "midpnt", url.host == "group" {
            model.openGroup(id: url.lastPathComponent)
        } else if let invite = Invite.parse(url) {
            await model.open(invite)
        }
    }
}
