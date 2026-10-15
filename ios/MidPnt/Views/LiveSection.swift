import SwiftUI
import MidPntCore

struct LiveSection: View {
    @Bindable var model: AppModel
    @State private var code = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Live").microHeader()
            if let url = model.shareURL, let c = model.liveCode {
                Text("Everyone's pin updates in place. Share this to invite people:").font(Typo.body).foregroundStyle(Palette.muted)
                HStack {
                    Text(c).font(Typo.data(15)).foregroundStyle(Palette.ink).textSelection(.enabled)
                    Spacer()
                    // The share sheet is the primary invite, not copy-the-code.
                    ShareLink(item: url, subject: Text("MidPnt"), message: Text("Where should we meet? Add where you're starting from.")) {
                        Label("Invite", systemImage: "square.and.arrow.up")
                    }.font(Typo.label)
                }
                Button("Leave session", role: .destructive) { Task { await model.leave() } }.font(Typo.label).frame(minHeight: 44)
            } else {
                Text("Start a session and share a link — everyone adds where they're starting from.").font(Typo.body).foregroundStyle(Palette.muted)
                Button { Task { await model.goLive() } } label: { Label("Go live", systemImage: "dot.radiowaves.left.and.right") }
                    .font(Typo.heading).frame(minHeight: 44)
                HStack {
                    TextField("Have a code?", text: $code).font(Typo.data(15)).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .padding(10).background(Palette.field, in: RoundedRectangle(cornerRadius: 10))
                    Button("Join") { Task { await model.join(code: code) } }.font(Typo.label).frame(minHeight: 44)
                        .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .padding(14).background(Palette.panel, in: RoundedRectangle(cornerRadius: 14))
    }
}
