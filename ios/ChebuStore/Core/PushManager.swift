import Foundation
import Observation
import UIKit
import UserNotifications

@MainActor
@Observable
final class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()

    var status: UNAuthorizationStatus = .notDetermined
    var openOrder: Int?
    var registrationError: String?
    private(set) var deviceToken: String?
    private var active = false

    #if DEBUG
    static let environment = "sandbox"
    #else
    static let environment = "production"
    #endif

    var isAllowed: Bool { status == .authorized || status == .provisional || status == .ephemeral }

    func refreshStatus() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func requestIfNeeded() async {
        await refreshStatus()
        guard status == .notDetermined else { return }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await refreshStatus()
    }

    func enable() async {
        await requestIfNeeded()
        guard isAllowed else { return }
        active = true
        registrationError = nil
        UIApplication.shared.registerForRemoteNotifications()
        if deviceToken != nil { await upload() }
    }

    func disable() async {
        active = false
        guard let deviceToken else { return }
        let _: OK? = try? await APIClient.shared.post("/push/device/remove", ["token": deviceToken])
    }

    func sendTest() async throws {
        let _: OK = try await APIClient.shared.post("/push/test")
    }

    func didRegister(_ data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        if active { Task { await upload() } }
    }

    func didFail(_ error: Error) {
        registrationError = error.localizedDescription
    }

    private func upload() async {
        guard let deviceToken, APIClient.shared.token != nil else { return }
        let _: OK? = try? await APIClient.shared.post("/push/device", ["token": deviceToken, "environment": Self.environment])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        let number = (info["order"] as? NSNumber)?.intValue
        guard let number else { return }
        await MainActor.run { self.openOrder = number }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = PushManager.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushManager.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushManager.shared.didFail(error)
    }
}
