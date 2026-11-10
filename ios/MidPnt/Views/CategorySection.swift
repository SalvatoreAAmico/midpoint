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
                    if let c = Catalog.shared[id] { Chip(id: id, label: c.label, on: model.cats.contains(id)) { pick(id) } }
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
                    FlowLayout(spacing: 8) { ForEach(hits, id: \.id) { c in Chip(id: c.id, label: c.label, on: model.cats.contains(c.id)) { pick(c.id); query = "" } } }
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
    let id: String, label: String, on: Bool, action: () -> Void
    var body: some View {
        Button(action: action) {
            // The catalogue label leads with an emoji ("☕ Coffee"), which is the web app's
            // icon. Emoji depend on the system emoji font (missing in some simulator
            // runtimes, drawn as a box), so the app draws an SF Symbol and drops the emoji.
            Label { Text(CategoryIcon.name(label)).font(Typo.label) } icon: {
                if let sym = CategoryIcon.symbol[id] { Image(systemName: sym).font(Typo.label) }
            }
            .padding(.horizontal, 12).frame(minHeight: 44)
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

enum CategoryIcon {
    /// The label without its leading emoji.
    static func name(_ label: String) -> String {
        guard let i = label.firstIndex(of: " "), label[..<i].unicodeScalars.contains(where: { $0.value > 0x2000 })
        else { return label }
        return String(label[label.index(after: i)...])
    }

    /// Absent id means no icon, never a wrong one.
    static let symbol: [String: String] = [
        "coffee": "cup.and.saucer.fill", "food": "fork.knife", "drinks": "wineglass", "outdoors": "tree.fill",
        "culture": "paintpalette.fill", "screens": "film.fill", "games": "target", "quiet": "books.vertical.fill",
        "active": "figure.run", "icecream": "snowflake", "nightlife": "moon.stars.fill", "playground": "figure.and.child.holdinghands",
        "dogpark": "pawprint.fill", "beach": "beach.umbrella.fill", "nature": "mountain.2.fill", "swimming": "figure.pool.swim",
        "golf": "flag.fill", "zoo": "tortoise.fill", "themepark": "ticket.fill", "shopping": "bag.fill",
        "market": "basket.fill", "landmarks": "building.columns.fill", "arts": "theatermasks.fill", "deli": "takeoutbag.and.cup.and.straw.fill",
        "breakfast": "sun.horizon.fill", "lunch": "fork.knife", "dinner": "fork.knife", "pizza": "fork.knife",
        "sushi": "fork.knife", "mexican": "fork.knife", "italian": "fork.knife", "chinese": "fork.knife",
        "thai": "fork.knife", "indian": "fork.knife", "korean": "fork.knife", "burger": "fork.knife",
        "bbq": "flame.fill", "seafood": "fish.fill", "vegan": "leaf.fill", "mediterranean": "fork.knife",
    ]
}
