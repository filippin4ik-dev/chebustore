import AuthenticationServices
import CryptoKit
import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class AuthStore {
    var user: User?
    var config: PublicConfig?
    var ready = false

    private let api = APIClient.shared
    private var webAuth: ASWebAuthenticationSession?
    private let presenter = WebAuthPresenter()

    init() {
        NotificationCenter.default.addObserver(forName: .sessionExpired, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.api.token = nil
                self?.user = nil
            }
        }
    }

    func bootstrap() async {
        async let cfg: PublicConfig? = try? api.get("/config")
        if api.token != nil {
            let me: UserEnvelope? = try? await api.get("/auth/me")
            user = me?.user
            if user == nil { api.token = nil }
        }
        config = await cfg
        ready = true
    }

    func requestCode(email: String) async throws -> Int {
        let r: ResendEnvelope = try await api.post("/auth/email/request", ["email": email])
        return r.resendIn
    }

    func verify(email: String, code: String) async throws {
        let r: TokenEnvelope = try await api.post("/auth/email/verify", ["email": email, "code": code, "client": "IOS"])
        api.token = r.token
        user = r.user
    }

    /// Telegram login through the website in an ephemeral ASWebAuthenticationSession, secured with PKCE + state.
    func loginWithTelegram() async throws {
        let verifier = Self.randomURLSafe(32)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded()
        let state = Self.randomURLSafe(24)

        var comps = URLComponents(url: api.url("/auth/app"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "challenge", value: challenge),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "method", value: "telegram"),
        ]

        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: "chebustore") { url, error in
                if let url { cont.resume(returning: url) } else {
                    cont.resume(throwing: error ?? APIError(status: 0, code: "cancelled", message: "Вход отменён"))
                }
            }
            session.prefersEphemeralWebBrowserSession = true
            session.presentationContextProvider = presenter
            webAuth = session
            session.start()
        }
        webAuth = nil

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else {
            throw APIError(status: 0, code: "state", message: "Не удалось подтвердить вход, попробуйте ещё раз")
        }
        let r: TokenEnvelope = try await api.post("/auth/app/exchange", ["code": code, "verifier": verifier])
        api.token = r.token
        user = r.user
    }

    func updateProfile(firstName: String, lastName: String, phone: String) async throws {
        let r: UserEnvelope = try await api.patch("/account/profile", ["firstName": firstName, "lastName": lastName, "phone": phone])
        user = r.user
    }

    func logout() async {
        let _: OK? = try? await api.post("/auth/logout")
        api.token = nil
        user = nil
    }

    private static func randomURLSafe(_ bytes: Int) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return data.base64URLEncoded()
    }
}

private final class WebAuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}

extension Data {
    func base64URLEncoded() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
