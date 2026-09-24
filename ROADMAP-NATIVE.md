# If we build a native iOS app

A running list of what a Swift app would actually buy us — kept honest, because
"we'll do it in the native version" is where wishful features go to hide.

Add to this whenever something is blocked by the web platform. Before adding,
check the third section: several things that *feel* native-only aren't.

---

## 1. Genuinely impossible on the web — these are the reasons to go native

- [ ] **Background location.** The headline one. A PWA gets location only while
      open in Safari, so "ping me when two friends are near each other" cannot
      work today. Everything else on this list is a convenience; this is a
      different product. Note it is also the single most-rejected App Store
      permission — expect to justify it in review notes.
- [ ] **Reliable push notifications.** Web push works on iOS 16.4+ but only once
      the user adds the site to their Home Screen, which most never do. Native
      push is dependable, and any recurring-hangout feature leans on it.
- [ ] **Live Activities / Dynamic Island.** "Meeting at Bow Truss, 12 min away"
      on the lock screen while travelling. No web equivalent.
- [ ] **Home Screen widget.** "Where's the crew tonight?" at a glance.
- [ ] **Real Contacts access.** Pick friends from the address book instead of
      typing names. The web has no equivalent worth using.
- [ ] **Share sheet integration.** Send an invite from anywhere in iOS.
- [ ] **MapKit look-around / native map polish.** Leaflet is fine; MapKit is
      nicer, free, and unlimited on Apple platforms.
- [ ] **App Store presence.** A PWA cannot be listed. This is a distribution
      question, not a technical one, but it is real.

## 2. Possible on the web, meaningfully better native

- [ ] **Sign in with Apple.** Works on web, but native is one tap with Face ID.
- [ ] **Offline behaviour.** Service workers exist; native is less fragile.
- [ ] **Haptics.** Web vibration is not supported in iOS Safari.
- [ ] **Smoother maps and transitions.** Perceptible on older phones.
- [ ] **Not getting cache-bitten.** Web deploys can serve stale JS to phones
      (this already happened once); native ships versioned binaries.

## 3. Does NOT need native — do not wait for the app to build these

- [x] ~~**Device name auto-fill.**~~ **Not available natively either.** iOS 16
      closed `UIDevice.current.name`; it returns `"iPhone"` unless Apple grants
      `com.apple.developer.device-information.user-assigned-device-name`, which
      needs written justification and is often refused. Remembering the name the
      user typed is the correct answer on both platforms. *(Already shipped.)*
- [ ] **Saved groups ("the Tuesday crew").** Local storage handles this with no
      account and no backend. Build it on the web first.
- [ ] **Foreground live location sharing.** Already working today.
- [ ] **Accounts / SSO.** Works fine on the web. Only worth adding when
      cross-device sync or notifications actually demand it.
- [ ] **Add to Home Screen.** Gets an icon and a full-screen launch for free.
- [ ] **Better suggestions, fairness tuning, filters.** All algorithm work —
      platform-independent, and the most valuable work available.

## 3b. Known gaps, not native-related

- [ ] **Transit times.** No free transit-routing API worth using; needs a
      self-hosted OpenTripPlanner. This is the real reason the app is US-shaped:
      driving is a fair default in most US metros and a poor one in European
      cities. Walking mode covers dense areas in the meantime.
- [ ] **Chain detection is US-centric** beyond the `brand` tag. A London user
      would see Pret and Greggs offered as independents.
- [ ] **Parking.** `amenity=parking` is densely mapped; showing nearby parking
      for a chosen venue is cheap and has no native dependency. Worth doing when
      driving mode is the common case.

## 4. What going native actually costs

| | |
|---|---|
| Apple Developer Program | **$99/year**, unavoidable |
| A Mac for Xcode | ~$599 new Mac mini, less used |
| TestFlight (10k testers, no full review) | free |
| App Store review | free; 1 day–2 weeks, longer with background location |

**Code reuse, measured rather than estimated.** Of 1,702 lines in `app.js`,
591 across 39 functions touch no DOM at all — scoring, fairness, outlier
detection, opening hours, chain detection, category search, and the
Nominatim/Overpass/OSRM calls. Those port mechanically. The other 980 lines
across 26 functions are rendering and events, and are a rewrite: HTML/CSS →
SwiftUI, Leaflet → MapKit, Geolocation → CoreLocation, localStorage →
SwiftData. `sync.js` (233 lines) ports near 1:1. `supabase/schema.sql` is
untouched: the backend does not care what talks to it.

**So roughly 38% of the app logic carries over, plus the entire backend.**

The more valuable asset is the test suite: 1,391 lines encoding 254 decisions,
including why the fairness spread penalty beats a closest-to-one-person venue
and why a chain-only area must still return results. A Swift port that passes
equivalent assertions is correct by construction, and rewriting that knowledge
from scratch would cost more than the code.

## 5. Decision: we are building the app

Taken deliberately, not by default. The reasoning: an icon on the home screen
is a standing invitation where a URL has to be remembered; App Store presence
does real trust work for an app asking for someone's location; and the two
features that make this habitual — push and background location — are native
only.

### What "a functional version" means here

The web version is already functional. What it is not yet is *worth
reopening*, and that is the gap the port must not paper over. An icon creates
the opportunity for a habit; a reason to return creates the habit. An app
opened twice gets deleted, and a deleted app is worse than a bookmark.

So the bar for starting Swift is not "does it work" but "would someone open it
again next week".

### Pre-port checklist

Do these on the web, where iteration is minutes rather than an App Store
review cycle:

- [ ] **Used for one real meetup with a real friend.** Still not done. Every
      technical unknown is now closed; the product unknown is entirely open.
      If the suggestions are not good, a native shell does not save them.
- [x] ~~**Saved groups.**~~ Done. Open the app, tap the group, everyone is back.
- [ ] **Something worth returning *to*.** Recurring hangouts, a history of
      where you have been, a veto list — any of it. Without one of these there
      is nothing for a notification to say.
- [ ] **A second real meetup, using the saved group.** Proof the loop closes.

### On wrapping the web app — considered and rejected

Capacitor or a similar shell would keep one codebase and still reach the App
Store. It is a worse idea than it sounds in 2026.

Guideline 4.2 requires an app to "include features, content, and UI that
elevate them beyond a repackaged website". It says nothing about how the app is
built — WebView, Capacitor and Swift are all acceptable — only about whether
the result does something a website cannot. Apple has added reviewers and
automated more of review specifically because wrappers were lowering quality,
and a shell that opens a WebView onto the existing site is reported to fail.

The trap is circular, and worth stating plainly. To pass 4.2 the app needs
native navigation, push, background location and real offline behaviour — which
are precisely the things that would justify going native at all. Building them
erases the wrapper's advantage: it saves the UI rewrite, then the guideline
pushes you to write native UI anyway.

The tempting version is the one that fails hardest: ship a thin wrapper early to
get listed, add native capability later. That is the textbook rejection.

So there are two options, not three: stay on the web, or commit to Swift when
something genuinely requires it. A wrapper is only sensible in the narrow case
where substantial native surface already exists and the goal is merely to keep
the scoring engine in JavaScript.

### Then the port, cheapest path first

1. **TestFlight before the App Store.** Up to 10,000 testers, no full review.
   A real icon on a real home screen, which is the actual habit hypothesis,
   without waiting on review. This is the cheap experiment.
2. **Port the logic first** — scoring, tag mapping, API calls are near 1:1.
3. **Ship without background location initially.** It is the most-rejected
   permission; get approved, then add it in an update with usage data to
   justify it.
4. **App Store listing** once TestFlight users are actually reopening it.
