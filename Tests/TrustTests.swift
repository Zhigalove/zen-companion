import CryptoKit
import Foundation

@main struct TrustTests {
  static func main() throws {
    let key = Curve25519.Signing.PrivateKey()
    let payload = try JSONEncoder().encode(
      SignedUpdate(
        version: "9.0.0",
        url: "https://github.com/Zhigalove/zen-companion/releases/download/v9.0.0/test.zip",
        sha256: String(repeating: "a", count: 64)))
    let data = try JSONEncoder().encode(
      Envelope(
        payload: payload.base64EncodedString(),
        signature: try key.signature(for: payload).base64EncodedString()))
    let verified = try Updates.verify(data, key: key.publicKey.rawRepresentation)
    assert(verified.version == "9.0.0")
    let other = Curve25519.Signing.PrivateKey()
    var rejected = false
    do { _ = try Updates.verify(data, key: other.publicKey.rawRepresentation) } catch {
      rejected = true
    }
    assert(rejected)
    let bad = try JSONEncoder().encode(
      Envelope(
        payload: Data("tampered".utf8).base64EncodedString(),
        signature: try key.signature(for: payload).base64EncodedString()))
    rejected = false
    do { _ = try Updates.verify(bad, key: key.publicKey.rawRepresentation) } catch {
      rejected = true
    }
    assert(rejected)
    let outside = try JSONEncoder().encode(
      SignedUpdate(
        version: "9.0.0", url: "https://example.org/test.zip",
        sha256: String(repeating: "a", count: 64)))
    let envelope = try JSONEncoder().encode(
      Envelope(
        payload: outside.base64EncodedString(),
        signature: try key.signature(for: outside).base64EncodedString()))
    rejected = false
    do { _ = try Updates.verify(envelope, key: key.publicKey.rawRepresentation) } catch {
      rejected = true
    }
    assert(rejected)
    print("PASS: signed update, wrong key, tampered payload, unapproved download host")
  }
}
