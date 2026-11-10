import WidgetKit
import ActivityKit
import SwiftUI

struct MeetupLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MeetupAttributes.self) { context in
            // Lock Screen
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Meeting at").font(.caption).foregroundStyle(Palette.muted)
                    Text(context.state.name).font(.headline).foregroundStyle(Palette.ink).lineLimit(1)
                    if !context.state.town.isEmpty { Text(context.state.town).font(.caption).foregroundStyle(Palette.muted) }
                }
                Spacer()
                Minutes(state: context.state)
            }
            .padding().activityBackgroundTint(Palette.panel)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Text(context.state.name).font(.headline).lineLimit(1) }
                DynamicIslandExpandedRegion(.trailing) { Minutes(state: context.state) }
            } compactLeading: {
                Image(systemName: "mappin.circle.fill").foregroundStyle(Palette.accent)
            } compactTrailing: {
                Text(context.state.minutes.map { "\(context.state.estimated ? "~" : "")\($0)m" } ?? "—")
            } minimal: {
                Image(systemName: "mappin.circle.fill").foregroundStyle(Palette.accent)
            }
        }
    }
}

private struct Minutes: View {
    let state: MeetupAttributes.ContentState
    var body: some View {
        if let m = state.minutes {
            Text("\(state.estimated ? "~" : "")\(m) min").font(.custom("JetBrains Mono", size: 17, relativeTo: .headline)).foregroundStyle(Palette.accent)
        } else {
            Text("add your location").font(.caption).foregroundStyle(Palette.muted)
        }
    }
}
