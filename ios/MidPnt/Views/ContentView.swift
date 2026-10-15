import SwiftUI
import MidPntCore

struct ContentView: View {
    @Bindable var model: AppModel
    @State private var selected: String?
    @State private var showGroups = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("MidPnt").font(Typo.display).foregroundStyle(Palette.ink)
                    Text("Meet in the middle — the fair one.").font(Typo.body).foregroundStyle(Palette.muted)

                    VenueMap(model: model, selected: $selected).frame(height: 240)
                        .clipShape(RoundedRectangle(cornerRadius: 14))

                    PeopleSection(model: model)
                    CategorySection(model: model)
                    FiltersSection(model: model)
                    FindButton(model: model)
                    if !model.note.isEmpty { Text(model.note).font(Typo.body).foregroundStyle(Palette.muted).accessibilityIdentifier("note") }
                    if !model.liveError.isEmpty { Text(model.liveError).font(Typo.body).foregroundStyle(Palette.bad) }
                    ResultsView(model: model, selected: $selected)
                    if model.liveAvailable { LiveSection(model: model) }
                }
                .padding(.horizontal, 16).padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Palette.bg)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { showGroups = true } label: { Image(systemName: "person.2") }.accessibilityLabel("Saved groups")
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showGroups) { GroupsSheet(model: model) }
            .sheet(isPresented: $showSettings) { SettingsView(model: model) }
        }
        .tint(Palette.accent)
    }
}

struct FindButton: View {
    @Bindable var model: AppModel
    var body: some View {
        Button {
            Task {
                // A tap on a Button does not end editing, so a place typed without pressing
                // return is still in the field. Resigning commits it (PersonRow saves on blur);
                // then wait for that geocode, or the search runs without the person.
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                try? await Task.sleep(for: .milliseconds(200))
                var waited = 0
                while model.people.contains(where: { $0.locating }), waited < 80 {
                    try? await Task.sleep(for: .milliseconds(100)); waited += 1
                }
                await model.search()
            }
        } label: {
            HStack {
                if model.searching { ProgressView().tint(Palette.accentInk) }
                Text(model.searching ? "Searching…" : "Find meetup spots").font(Typo.heading)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Palette.accent, in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(Palette.accentInk)
        }
        .disabled(model.searching)
    }
}
