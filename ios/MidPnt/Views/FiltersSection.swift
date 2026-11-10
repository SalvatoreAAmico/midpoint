import SwiftUI
import MidPntCore

struct FiltersSection: View {
    @Bindable var model: AppModel
    private static let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Details").microHeader()
            Picker("Getting there", selection: bind(\.travel)) {
                Text("Driving").tag(Travel.drive); Text("Walking").tag(Travel.walk)
            }.pickerStyle(.segmented)

            HStack {
                Picker("When", selection: bind(\.when)) {
                    Text("Any time").tag(""); Text("Open now").tag("now")
                    ForEach(0..<7, id: \.self) { Text(Self.days[$0]).tag(String($0)) }
                }
                if Int(model.filters.when) != nil {
                    DatePicker("", selection: timeBinding, displayedComponents: .hourAndMinute).labelsHidden()
                }
            }.font(Typo.label)

            Toggle("Hide chains", isOn: bind(\.noChains)).font(Typo.label).tint(Palette.accent)
            Picker("Price", selection: bind(\.maxPrice)) {
                Text("Any price").tag(""); Text("$").tag("1"); Text("$$").tag("2"); Text("$$$").tag("3"); Text("$$$$").tag("4")
            }.font(Typo.label)
        }
    }

    /// Every change travels with the session, so nobody ends up looking at a different list.
    private func bind<T>(_ kp: WritableKeyPath<Filters, T>) -> Binding<T> {
        Binding(get: { model.filters[keyPath: kp] }, set: { v in var f = model.filters; f[keyPath: kp] = v; Task { await model.setFilters(f) } })
    }

    private var timeBinding: Binding<Date> {
        Binding(
            get: {
                let p = model.filters.whenTime.split(separator: ":").compactMap { Int($0) }
                return Calendar.current.date(bySettingHour: p.first ?? 19, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
            },
            set: { d in
                let c = Calendar.current.dateComponents([.hour, .minute], from: d)
                var f = model.filters; f.whenTime = String(format: "%02d:%02d", c.hour ?? 19, c.minute ?? 0)
                Task { await model.setFilters(f) }
            })
    }
}
