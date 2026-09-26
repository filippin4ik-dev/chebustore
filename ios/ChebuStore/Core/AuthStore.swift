import Foundation
import Observation
import UIKit

struct TelegramLoginStart: Decodable, Equatable {
    let id: String
    let secret: String
    let url: String
    let appUrl: String
}

private struct TelegramPoll: Decodable {
    let status: String
    let user: User?
    let token: String?
}

@MainActor
@Observable
final class AuthStore {
    var user: User?
    var ready = false
    var config: PublicConfig?

    private let api = APIClient.shared

    init() {
        NotificationCenter.default.addObserver(forName: .sessionExpired, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.api.token = nil
                self?.user = nil
            }
        }
    }

    func bootstrap() async {
        let api = self.api
        let cfg = Task { () -> PublicConfig? in try? await api.get("/config") }
        if api.token != nil {
            let me: UserEnvelope? = try? await api.get("/auth/me")
            user = me?.user
            if user == nil { api.token = nil }
        }
        config = await cfg.value
        ready = true
    }

    func refreshConfig() async {
        if let cfg: PublicConfig = try? await api.get("/config") { config = cfg }
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

    func startTelegramLogin() async throws -> TelegramLoginStart {
        let start: TelegramLoginStart = try await api.post("/auth/telegram/bot/start", ["client": "IOS"])
        openTelegram(start)
        return start
    }

    func openTelegram(_ start: TelegramLoginStart) {
        guard let app = URL(string: start.appUrl), let web = URL(string: start.url) else { return }
        UIApplication.shared.open(app) { opened in
            if !opened { UIApplication.shared.open(web) }
        }
    }

    func pollTelegram(_ start: TelegramLoginStart) async throws -> Bool {
        let r: TelegramPoll = try await api.post("/auth/telegram/bot/poll", ["id": start.id, "secret": start.secret])
        guard r.status == "ok", let token = r.token, let u = r.user else { return false }
        api.token = token
        user = u
        return true
    }

    func logout() async {
        await PushManager.shared.disable()
        let _: OK? = try? await api.post("/auth/logout")
        api.token = nil
        user = nil
    }
}
