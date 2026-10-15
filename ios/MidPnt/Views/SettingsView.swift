import SwiftUI
import MidPntCore

struct SettingsView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Open places in") {
                    Picker("Maps app", selection: Binding(get: { model.mapsApp }, set: { model.setMapsApp($0) })) {
                        Text("Apple Maps").tag(Maps.App.apple); Text("Google Maps").tag(Maps.App.google); Text("OpenStreetMap").tag(Maps.App.osm)
                    }
                }
                Section {
                    // Set by Sal once the reviewed policy has a stable address (TODO.md); hidden until then.
                    if let u = AppEnvironment.url("MPPrivacyURL") { Link("Privacy policy", destination: u) }
                    if let u = AppEnvironment.url("MPTermsURL") { Link("Terms", destination: u) }
                } footer: { Text("Appearance follows your phone's Light/Dark setting.") }
                Section("About") {
                    LabeledContent("Version", value: AppEnvironment.version)
                    // So "I don't see it" still has a number for an answer.
                    LabeledContent("Build", value: AppEnvironment.build)
                    Text("Map data © OpenStreetMap contributors. Travel times by OSRM.").font(Typo.label).foregroundStyle(Palette.muted)
                }
            }
            .navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
