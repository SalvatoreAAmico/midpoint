import SwiftUI
import MidPntCore

struct PeopleSection: View {
    @Bindable var model: AppModel
    @State private var locator = LocationProvider()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Who's coming").microHeader()
            ForEach(Array(model.people.enumerated()), id: \.element.id) { index, person in
                PersonRow(model: model, person: person, color: Palette.route[index % Palette.route.count], locator: locator)
            }
            if model.people.count < Limits.maxPeople {
                Button { model.addPerson() } label: { Label("Add someone", systemImage: "plus") }
                    .font(Typo.label).frame(minHeight: 44)
            }
        }
    }
}

struct PersonRow: View {
    @Bindable var model: AppModel
    let person: Person
    let color: Color
    let locator: LocationProvider
    @State private var name = ""
    @State private var place = ""

    private var isMe: Bool { person.id == model.me }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Circle().fill(color).frame(width: 12, height: 12)
                    .overlay(Circle().stroke(Palette.pinRing, lineWidth: 2))
                TextField("Name", text: $name).font(Typo.heading)
                    .onSubmit { Task { await model.setName(person.id, name) } }
                if model.people.count > 1 {
                    Button { model.removePerson(person.id) } label: { Image(systemName: "xmark.circle") }
                        .foregroundStyle(Palette.dim).accessibilityLabel("Remove \(person.name)")
                }
            }
            HStack(spacing: 8) {
                TextField("Where from? (a place or address)", text: $place).font(Typo.body)
                    .textInputAutocapitalization(.words).submitLabel(.search)
                    .onSubmit { Task { await model.setPlace(person.id, typed: place) } }
                    .padding(10).background(Palette.field, in: RoundedRectangle(cornerRadius: 10))
                // Only your own phone can say where *you* are.
                if isMe || !model.isLive {
                    Button { Task { await locate() } } label: { Image(systemName: "location") }
                        .frame(width: 44, height: 44).accessibilityLabel("Use my location")
                }
            }
            Text(status).font(Typo.label).foregroundStyle(Palette.muted)
            Toggle("Happy to travel further", isOn: Binding(get: { person.flex }, set: { model.setFlex(person.id, $0) }))
                .font(Typo.label).tint(Palette.accent)
        }
        .padding(12).background(Palette.panel, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Palette.line, lineWidth: 1))
        .onAppear { name = person.name; place = person.label }
        .onChange(of: person.name) { _, n in if n != name { name = n } }
        .onChange(of: person.label) { _, l in place = l }
    }

    private var status: String {
        if person.locating { return "Finding where that is…" }
        if person.coordinate != nil { return isMe && model.isLive ? "You — on the map" : (person.label.isEmpty ? "On the map" : person.label) }
        return model.isLive ? (isMe ? "Tap the arrow to add yourself" : "Joined, no location shared yet") : "No location yet"
    }

    private func locate() async {
        do {
            let c = try await locator.currentCoordinate()
            await model.setLocation(person.id, lat: c.latitude, lon: c.longitude)
        } catch LocationProvider.Failure.denied {
            // Declining is not an error, so this is a note, not red.
            model.note = "Location is off for MidPnt. Type a place instead, or turn it on in Settings."
        } catch { model.note = "Couldn't get your location just now. Type a place instead." }
    }
}
