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

## 4. What going native actually costs

| | |
|---|---|
| Apple Developer Program | **$99/year**, unavoidable |
| A Mac for Xcode | ~$599 new Mac mini, less used |
| TestFlight (10k testers, no full review) | free |
| App Store review | free; 1 day–2 weeks, longer with background location |

**Code reuse:** the scoring, tag mapping, and API calls port near 1:1 —
call it 25–30%. The UI is a rewrite: HTML/CSS → SwiftUI, Leaflet → MapKit,
Geolocation → CoreLocation, localStorage → SwiftData.

## 5. The honest trigger

Do not port because the web version feels like a compromise. Port when a
specific person wants a specific thing on this list — most likely background
location or push — and the web version is genuinely blocking them.

Until then, section 3 is where the value is.
