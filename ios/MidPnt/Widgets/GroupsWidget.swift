import WidgetKit
import SwiftUI
import MidPntCore

/// "Where's the crew tonight?" at a glance: saved groups, one tap to load one
/// into the app. Reads the same `midpoint.groups` key the app writes, through
/// the shared App Group. No server.
struct GroupsEntry: TimelineEntry { let date: Date; let groups: [SavedGroup] }

struct GroupsProvider: TimelineProvider {
    private func load() -> [SavedGroup] {
        GroupStore.load(UserDefaultsStore(UserDefaults(suiteName: "group.com.salvatoreaamico.midpnt") ?? .standard))
    }
    func placeholder(in context: Context) -> GroupsEntry {
        GroupsEntry(date: Date(), groups: [SavedGroup(id: "x", name: "The Tuesday crew", people: [])])
    }
    func getSnapshot(in context: Context, completion: @escaping (GroupsEntry) -> Void) { completion(GroupsEntry(date: Date(), groups: load())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<GroupsEntry>) -> Void) {
        // Groups change only when the user saves one, and the app reloads the timeline then.
        completion(Timeline(entries: [GroupsEntry(date: Date(), groups: load())], policy: .never))
    }
}

struct GroupsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "MidPntGroups", provider: GroupsProvider()) { entry in
            GroupsWidgetView(entry: entry).containerBackground(Palette.bg, for: .widget)
        }
        .configurationDisplayName("Saved groups")
        .description("Jump straight to finding a fair spot for the usual crew.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct GroupsWidgetView: View {
    let entry: GroupsEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        if entry.groups.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("MidPnt").font(.headline).foregroundStyle(Palette.ink)
                Text("Save a group in the app and it appears here.").font(.caption).foregroundStyle(Palette.muted)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Where's the crew?").font(.caption.weight(.semibold)).foregroundStyle(Palette.muted)
                ForEach(entry.groups.prefix(family == .systemSmall ? 2 : 3), id: \.id) { g in
                    Link(destination: URL(string: "midpnt://group/\(g.id)")!) {
                        HStack {
                            Image(systemName: "person.2.fill").foregroundStyle(Palette.accent)
                            Text(g.name).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                        }.frame(minHeight: 28)
                    }
                }
            }
        }
    }
}
