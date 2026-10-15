import Observation
import ActivityKit
import MidPntCore

/// Starts, updates and ends the Live Activity as the group's decision comes and goes.
@MainActor @Observable
final class MeetupActivityController {
    private var activity: Activity<MeetupAttributes>?

    func update(_ s: AppModel.MeetupSummary?) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        guard let s else {
            await activity?.end(nil, dismissalPolicy: .immediate); activity = nil; return
        }
        let state = MeetupAttributes.ContentState(name: s.name, town: s.town, minutes: s.minutes, estimated: s.estimated)
        let content = ActivityContent(state: state, staleDate: nil)
        if let activity, activity.attributes.venueKey == s.venueKey {
            await activity.update(content)
        } else {
            // A different place won (someone changed their mind): replace, never stack.
            await activity?.end(nil, dismissalPolicy: .immediate)
            activity = try? Activity.request(attributes: MeetupAttributes(venueKey: s.venueKey), content: content, pushType: nil)
        }
    }
}
