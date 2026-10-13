import SwiftUI
import MidPntCore

struct CategorySection: View {
    @Bindable var model: AppModel
    @State private var query = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What are you up for?").microHeader()
            FlowLayout(spacing: 8) {
                ForEach(shown, id: \.self) { id in
                    if let c = Catalog.shared[id] { Chip(label: c.label, on: model.cats.contains(id)) { pick(id) } }
                }
                Button { Task { await model.rollLucky() } } label: {
                    Label("Feeling lucky", systemImage: "dice").font(Typo.label)
                        .padding(.horizontal, 12).frame(minHeight: 44)
                        .background(model.lucky ? Palette.accent : Palette.field, in: Capsule())
                        .foregroundStyle(model.lucky ? Palette.accentInk : Palette.ink)
                }
            }
            TextField("Or search: pizza, axe throwing, a quiet café…", text: $query).font(Typo.body)
                .padding(10).background(Palette.field, in: RoundedRectangle(cornerRadius: 10))
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                let hits = Catalog.shared.search(query)
                if hits.isEmpty {
                    Text("Nothing matches “\(query.trimmingCharacters(in: .whitespaces))”. Try a broader word — “drinks”, “food”, “outdoors”.")
                        .font(Typo.body).foregroundStyle(Palette.muted)
                } else {
                    FlowLayout(spacing: 8) { ForEach(hits, id: \.id) { c in Chip(label: c.label, on: model.cats.contains(c.id)) { pick(c.id); query = "" } } }
                }
            }
        }
    }

    /// The eight headline chips plus anything picked from search, so a chosen
    /// category never disappears from view.
    private var shown: [String] {
        var seen = Set<String>(); return (Catalog.shared.chipIDs + model.cats).filter { seen.insert($0).inserted }
    }

    private func pick(_ id: String) {
        let adding = !model.cats.contains(id)
        Task {
            await model.toggleCat(id)
            if adding { model.applyMealTime(id, weekday: Calendar.current.component(.weekday, from: Date()) - 1) }
        }
    }
}

struct Chip: View {
    let label: String, on: Bool, action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label).font(Typo.label).padding(.horizontal, 12).frame(minHeight: 44)
                .background(on ? Palette.accent : Palette.field, in: Capsule())
                .foregroundStyle(on ? Palette.accentInk : Palette.ink)
        }
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Wraps chips onto as many lines as they need.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > w, x > 0 { x = 0; y += row + spacing; row = 0 }
            x += sz.width + spacing; row = max(row, sz.height)
        }
        return CGSize(width: w, height: y + row)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += row + spacing; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; row = max(row, sz.height)
        }
    }
}
