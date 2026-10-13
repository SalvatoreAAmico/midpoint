import CoreLocation

/// One-shot, when-in-use location. Background location is deliberately absent:
/// it comes last, in an update after approval, with usage data to justify it.
@MainActor
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    enum Failure: Error { case denied, unavailable }

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D, Error>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters      // a neighbourhood is plenty
    }

    func currentCoordinate() async throws -> CLLocationCoordinate2D {
        switch manager.authorizationStatus {
        case .denied, .restricted: throw Failure.denied
        default: break
        }
        return try await withCheckedThrowingContinuation { cont in
            continuation?.resume(throwing: Failure.unavailable)
            continuation = cont
            if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
            else { manager.requestLocation() }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: if continuation != nil { manager.requestLocation() }
            case .denied, .restricted: finish(.failure(Failure.denied))
            default: break
            }
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let c = locations.last?.coordinate else { return }
        Task { @MainActor in finish(.success(c)) }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in finish(.failure((error as? CLError)?.code == .denied ? Failure.denied : error)) }
    }
    private func finish(_ r: Result<CLLocationCoordinate2D, Error>) {
        continuation?.resume(with: r); continuation = nil
    }
}
