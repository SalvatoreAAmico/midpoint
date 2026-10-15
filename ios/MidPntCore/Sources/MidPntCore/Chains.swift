import Foundation

public enum Chains {
    /// OpenStreetMap tags branded venues with `brand` and `brand:wikidata`; an
    /// independent cafe essentially never carries either, so that is the
    /// primary signal. The name list (in catalog.json, generated from app.js)
    /// is a backup for franchises whose local entries were added without brand
    /// tags.
    public static func isChain(tags: [String: String], name: String?) -> Bool {
        for k in ["brand", "brand:wikidata", "brand:wikipedia"] where !(tags[k] ?? "").isEmpty { return true }
        guard let name, !name.isEmpty else { return false }
        return Catalog.shared.chainNames.firstMatch(in: name, range: NSRange(location: 0, length: (name as NSString).length)) != nil
    }
}
