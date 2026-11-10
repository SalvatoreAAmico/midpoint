import Foundation
import ActivityKit

/// The Lock Screen / Dynamic Island card for the chosen spot: "Bow Truss — 12 min".
/// Compiled into both the app and the widget extension. No server: the app
/// starts, updates and ends it locally (push-driven updates are a later,
/// separately reviewed piece of work).
struct MeetupAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var name: String
        var town: String
        /// Minutes for the person holding this phone; nil if they have no location.
        var minutes: Int?
        /// Straight-line stand-ins: shown with "~".
        var estimated: Bool
    }
    var venueKey: String
}
