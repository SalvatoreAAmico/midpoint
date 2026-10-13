import Foundation

/// The tuning constants of app.js, ported as literals. They are not read from
/// catalog.json on purpose: if someone retunes the fairness score in app.js,
/// `swift test` must fail until this file is changed in the same commit, or an
/// iPhone and a laptop would rank the same inputs differently.
public enum Limits {
    public static let maxPeople = 8
    public static let maxVenues = 25              // also caps the OSRM matrix URL length
    public static let speedDrive = 13.4           // m/s, fallback when OSRM is down
    public static let speedWalk = 1.05            // includes a detour factor: streets are not straight lines
    public static let maxRadiusDrive = 20000.0
    public static let maxRadiusWalk = 2500.0
    public static let togetherM = 250.0
    public static let togetherRadiusDrive = 4000.0
    public static let togetherRadiusWalk = 1500.0
    public static let spreadWeight = 0.9
    public static let flexWeight = 0.35
    public static let luckyCats = 3
    public static let luckyPool = 12
}
