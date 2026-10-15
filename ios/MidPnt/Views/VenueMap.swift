import SwiftUI
import MapKit
import MidPntCore

/// MapKit instead of Leaflet + OSM tiles: native, and it removes our exposure
/// to the OSM tile usage policy.
struct VenueMap: View {
    let model: AppModel
    @Binding var selected: String?
    @State private var position: MapCameraPosition = .automatic

    var body: some View {
        Map(position: $position) {
            ForEach(Array(model.people.enumerated()), id: \.element.id) { i, p in
                if let c = p.coordinate {
                    Annotation(p.name, coordinate: CLLocationCoordinate2D(latitude: c.lat, longitude: c.lon)) {
                        Circle().fill(Palette.route[i % Palette.route.count]).frame(width: 14, height: 14)
                            .overlay(Circle().stroke(Palette.pinRing, lineWidth: 2.5))
                    }
                }
            }
            ForEach(Array(model.results.prefix(12).enumerated()), id: \.element.venue.key) { rank, s in
                Annotation(s.venue.name, coordinate: CLLocationCoordinate2D(latitude: s.venue.lat, longitude: s.venue.lon)) {
                    ZStack {
                        Circle().fill(s.venue.key == selected ? Palette.accent : Palette.panel)
                        Text("\(rank + 1)").font(Typo.data(11)).foregroundStyle(s.venue.key == selected ? Palette.accentInk : Palette.ink)
                    }
                    .frame(width: 26, height: 26).overlay(Circle().stroke(Palette.pinRing, lineWidth: 2))
                    .onTapGesture { selected = s.venue.key }
                }
            }
        }
        .background(Palette.mapBg)
        .onChange(of: model.results.first?.venue.key) { _, _ in position = .automatic }
        // .automatic frames a lone annotation at maximum zoom: a crosswalk, no context.
        // One person gets a neighbourhood; two or more fit themselves.
        .onChange(of: model.people.compactMap(\.coordinate).map { "\($0.lat),\($0.lon)" }) { _, pts in
            guard model.results.isEmpty else { return }
            if pts.count == 1, let c = model.people.compactMap(\.coordinate).first {
                position = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: c.lat, longitude: c.lon),
                                                      span: MKCoordinateSpan(latitudeDelta: 0.06, longitudeDelta: 0.06)))
            } else { position = .automatic }
        }
        .onChange(of: selected) { _, key in
            guard let key, let s = model.results.first(where: { $0.venue.key == key }) else { return }
            withAnimation(.easeInOut(duration: 0.15)) {
                position = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: s.venue.lat, longitude: s.venue.lon),
                                                      span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)))
            }
        }
    }
}
