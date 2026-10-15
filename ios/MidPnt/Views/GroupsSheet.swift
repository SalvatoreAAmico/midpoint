import SwiftUI
import MidPntCore

struct GroupsSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField(Names.suggestGroupName(model.people).isEmpty ? "Name this group" : Names.suggestGroupName(model.people), text: $name)
                    Button("Save who's here") { model.saveGroup(named: name); name = "" }
                        .disabled(model.people.allSatisfy { $0.name.isEmpty && $0.coordinate == nil })
                } header: { Text("Save this group") }
                footer: { Text("Groups are kept on this phone only. Groups saved in the web app don't carry over.") }

                if !model.groups.isEmpty {
                    Section("Saved groups") {
                        ForEach(model.groups, id: \.id) { g in
                            Button { model.applyGroup(g); dismiss() } label: {
                                VStack(alignment: .leading) {
                                    Text(g.name).font(Typo.heading)
                                    Text(g.people.map { $0.name.isEmpty ? "—" : $0.name }.joined(separator: ", ")).font(Typo.label).foregroundStyle(Palette.muted)
                                }
                            }
                        }
                        .onDelete { idx in idx.map { model.groups[$0].id }.forEach(model.deleteGroup) }
                    }
                }
            }
            .scrollContentBackground(.hidden).background(Palette.bg)
            .navigationTitle("Saved groups").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
