# Privacy Policy — Midpoint

> **DRAFT — NOT YET IN FORCE.**
> Written by describing exactly what the code does, which makes it accurate but
> not legally reviewed. **Have a lawyer review it before the App Store, and
> before telling anyone it applies.** Location data is treated as sensitive
> personal information under the CCPA and as personal data under the GDPR, and
> the consequences of getting this wrong are not technical.
>
> Last updated: DRAFT · Effective: NOT YET

Midpoint helps a group find somewhere fair to meet. To do that it needs to know
roughly where people are. This explains what happens to that, in plain terms.

**The short version.** There are no accounts, no tracking, no advertising and
no analytics. Nothing about you is sold or shared for marketing. When you use a
live session, your location is stored for up to twelve hours and then deleted
automatically. When you don't, it is never stored on a server at all.

## What is collected

**Location.** Either from your device, if you allow it, or from a place name
you type. Coordinates are rounded to about one metre of precision.

**A display name**, if you type one. Whatever you type — it does not need to be
your real name, and the app never asks for it.

**Votes**, if you vote on a suggestion.

That is the complete list. No email address, no phone number, no contacts, no
photos, no device identifiers, no advertising ID, no browsing history.

## Where it goes

Midpoint works in two modes and they differ significantly.

**Link mode (the default).** Everything lives in the web address itself. It is
never sent to any server operated by us, because there isn't one. If you share
the link, whoever holds it can see what it contains — so treat a link as being
as sensitive as the locations inside it.

**Live sessions (only if you tap "Go live").** Names, coordinates and votes are
stored in a database hosted by Supabase so that other people in the session can
see them. Access requires the session's secret code; the database refuses all
other access by design. **Everything is deleted automatically twelve hours
after the session is created.** You can leave earlier, which removes you
immediately.

## Third parties that necessarily see something

The app asks other services for maps, place names and travel times. These are
requests your browser makes directly; we do not operate them and do not control
their policies.

| Service | What reaches it | Why |
|---|---|---|
| **OpenStreetMap Foundation** | The area of the map you are viewing; a place name you type, or coordinates when the app names your neighbourhood | Map tiles and geocoding |
| **Overpass API** (OSM) | The midpoint and a search radius | Finding places nearby |
| **Project OSRM** | **The coordinates of everyone in the group, and of candidate venues** | Travel times |
| **Supabase** | Live-session data only, as above | Sharing between devices |
| **GitHub Pages** | Standard web-server information, including IP address | Hosting |
| **unpkg (Fastly)** | Standard web-server information | Delivering the map library |

The OSRM row is the one worth reading twice: calculating travel times requires
sending participants' coordinates to a third-party routing service. There is no
way to compute real travel times without it. If that is not acceptable to you,
do not use the app.

## Stored on your own device

Three small items, in your browser, readable by nobody else: the name you last
used, which maps app you prefer for directions, and your identity within a live
session so refreshing the page does not add a duplicate of you. Clearing your
browser data removes them.

## What is never done

No cookies for tracking. No analytics or telemetry of any kind. No advertising,
and no advertising identifiers. Nothing is sold, and nothing is shared with data
brokers. There is no profile of you, because there is no account to attach one
to. Location history is not retained — there is nowhere it could be retained.

## Your choices and rights

**Refusing location is fully supported.** Type a neighbourhood instead; the app
works identically.

**Deletion.** Leave a session and your data is removed immediately. Otherwise
everything is deleted within twelve hours automatically. There is no account to
delete because there is no account.

**Access.** Everything held about you in a live session is already visible to
you on screen; there is nothing else.

Depending on where you live you may have rights under the GDPR, the UK GDPR or
the CCPA, including access, correction, deletion and objection. Given that
nothing persists beyond twelve hours and nothing is linked to an identity, most
of these resolve immediately. To ask anything, contact us at the address below.

## Children

Not directed to children under 13, and no data is knowingly collected from
them.

## Changes

Material changes will be noted here with a new date. Since nothing is stored
about you, there is no back catalogue for a change to apply to retroactively.

## Contact

**[ADD A REAL EMAIL ADDRESS BEFORE PUBLISHING]**
