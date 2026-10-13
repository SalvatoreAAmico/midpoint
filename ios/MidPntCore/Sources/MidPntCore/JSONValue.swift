import Foundation

/// Loosely typed JSON, for reading things other clients wrote. The hash in an
/// invite link is parsed by JS truthiness rules (`d.o ? 'now' : ''`,
/// `!!d.l`, `d.n === undefined`), and a typed Decodable would either reject
/// links the web app accepts or silently disagree about what "absent" means.
public enum JSONValue: Decodable, Sendable, Equatable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    /// JavaScript truthiness.
    var truthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0 && !n.isNaN
        case .string(let s): return !s.isEmpty
        case .array, .object: return true
        }
    }

    /// JavaScript `String(x)`.
    var jsString: String {
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return n == n.rounded() && abs(n) < 1e15 ? String(Int64(n)) : String(n)
        case .string(let s): return s
        case .array(let a): return a.map { $0.jsString }.joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    var double: Double? { if case .number(let n) = self { return n } else { return nil } }
    var string: String? { if case .string(let s) = self { return s } else { return nil } }
}
