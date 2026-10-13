import SwiftUI
import MidPntCore

struct ResultsView: View {
    @Bindable var model: AppModel
    @Binding var selected: String?
    @State private var showRuledOut = false

    private var visible: [ScoredVenue] {
        showRuledOut ? model.results : model.results.filter { !model.isVetoed($0.venue.key) }
    }
    private var hiddenCount: Int { model.results.count - model.results.filter { !model.isVetoed($0.venue.key) }.count }

    var body: some View {
        if !model.results.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                if let w = model.winner { WinnerBanner(venue: w.venue, model: model) }
                Text(model.together ? "Near you" : "Fairest first").microHeader()
                ForEach(Array(visible.enumerated()), id: \.element.venue.key) { rank, v in
                    VenueCard(model: model, scored: v, rank: rank + 1, selected: $selected)
                }
                if hiddenCount > 0 {
                    Button(showRuledOut ? "Hide the \(hiddenCount) ruled out" : "Show the \(hiddenCount) ruled out") { showRuledOut.toggle() }
                        .font(Typo.label).frame(minHeight: 44)
                }
            }
        }
    }
}

struct WinnerBanner: View {
    let venue: Venue
    let model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Everyone's in").microHeader()
            Text(venue.name).font(Typo.title).foregroundStyle(Palette.ink)
            Link(destination: model.mapsURL(for: venue)) { Label("Open in \(label)", systemImage: "map") }.font(Typo.label)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.goodBg, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Palette.goodLine))
    }
    private var label: String { ["apple": "Apple Maps", "google": "Google Maps", "osm": "OpenStreetMap"][model.mapsApp.rawValue] ?? "Maps" }
}

struct VenueCard: View {
    @Bindable var model: AppModel
    let scored: ScoredVenue
    let rank: Int
    @Binding var selected: String?

    private var v: Venue { scored.venue }
    private var tilde: String { model.estimated ? "~" : "" }
    private var longest: Double { max(scored.costs.values.max() ?? 1, 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(rank)").font(Typo.data(13)).foregroundStyle(Palette.dim)
                VStack(alignment: .leading, spacing: 2) {
                    Text(v.name).font(Typo.heading).foregroundStyle(Palette.ink)
                    Text([v.kind.replacingOccurrences(of: "_", with: " "), v.town].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(Typo.label).foregroundStyle(Palette.muted)
                }
                Spacer()
                if v.open == true { Pill(text: "Open", color: Palette.good) }
                if v.open == false { Pill(text: "Closed", color: Palette.warn) }
            }
            // Per-person bars: the picture of fairness. Rows follow the roster, not the cost array.
            ForEach(Array(model.people.enumerated()), id: \.element.id) { i, p in
                HStack(spacing: 8) {
                    Circle().fill(Palette.route[i % Palette.route.count]).frame(width: 8, height: 8)
                    Text(p.name.isEmpty ? "—" : p.name).font(Typo.label).foregroundStyle(Palette.muted).frame(width: 72, alignment: .leading).lineLimit(1)
                    if let c = scored.costs[p.id] {
                        GeometryReader { g in
                            Capsule().fill(Palette.route[i % Palette.route.count]).frame(width: max(6, g.size.width * c / longest), height: 6)
                                .frame(maxHeight: .infinity)
                        }.frame(height: 14)
                        Text(tilde + Hours.fmtMin(c)).font(Typo.data(12)).foregroundStyle(Palette.ink).frame(width: 64, alignment: .trailing)
                    } else {
                        Text("no location yet").font(Typo.label).foregroundStyle(Palette.dim)
                        Spacer()
                    }
                }
            }
            HStack {
                let t = model.tally(v.key)
                VoteButton(symbol: "hand.thumbsup", count: t.up, on: model.votes[v.key]?[model.me ?? ""] == 1) { Task { await model.vote(v.key, 1) } }
                VoteButton(symbol: "hand.thumbsdown", count: t.down, on: model.votes[v.key]?[model.me ?? ""] == -1) { Task { await model.vote(v.key, -1) } }
                Spacer()
                Button { selected = v.key } label: { Image(systemName: "scope") }.frame(width: 44, height: 44).accessibilityLabel("Show on map")
                Link(destination: model.mapsURL(for: v)) { Label("Maps", systemImage: "arrow.up.right.square") }.font(Typo.label)
            }
        }
        .padding(14).background(Palette.panel, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(selected == v.key ? Palette.accent : Palette.line, lineWidth: selected == v.key ? 2 : 1))
        .onTapGesture { selected = v.key }
    }
}

struct Pill: View {
    let text: String, color: Color
    var body: some View {
        Text(text).font(Typo.micro).foregroundStyle(color).padding(.horizontal, 8).padding(.vertical, 3)
            .background(Palette.field, in: Capsule())
    }
}

struct VoteButton: View {
    let symbol: String, count: Int, on: Bool, action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: on ? symbol + ".fill" : symbol)
                if count > 0 { Text("\(count)").font(Typo.data(12)) }
            }
            .frame(minWidth: 44, minHeight: 44).foregroundStyle(on ? Palette.accent : Palette.muted)
        }
    }
}
