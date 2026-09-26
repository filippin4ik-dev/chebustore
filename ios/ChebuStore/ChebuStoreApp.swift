import SwiftUI

@main
struct ChebuStoreApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .tint(Color.accent(auth.config?.theme))
                .task { await auth.bootstrap() }
        }
    }
}

struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    @State private var privacyCover = false

    var body: some View {
        Group {
            if !auth.ready {
                ProgressView()
            } else if let user = auth.user {
                if user.isStaff {
                    AdminTabs()
                } else {
                    NoAccessView()
                }
            } else {
                LoginView()
            }
        }
        .overlay {
            if privacyCover {
                Rectangle().fill(.background).ignoresSafeArea().overlay(BrandLogo(size: 120))
            }
        }
        .onChange(of: scenePhase) { _, phase in
            privacyCover = phase != .active
            if phase == .active { Task { await syncPush() } }
        }
        .task { await PushManager.shared.requestIfNeeded() }
        .task(id: auth.user?.id) { await syncPush() }
    }

    private func syncPush() async {
        if auth.user?.isStaff == true {
            await PushManager.shared.enable()
        } else {
            await PushManager.shared.refreshStatus()
        }
    }
}

private struct OrderRef: Identifiable {
    let id: Int
}

struct AdminTabs: View {
    @State private var tab = 0
    private let push = PushManager.shared

    var body: some View {
        TabView(selection: $tab) {
            AdminHomeView()
                .tabItem { Label("Сводка", systemImage: "chart.bar") }
                .tag(0)
            NavigationStack { AdminOrdersView(status: nil) }
                .tabItem { Label("Заказы", systemImage: "list.bullet.rectangle") }
                .tag(1)
            NavigationStack { AdminProductsView() }
                .tabItem { Label("Товары", systemImage: "tag") }
                .tag(2)
            AdminMoreView()
                .tabItem { Label("Ещё", systemImage: "ellipsis.circle") }
                .tag(3)
        }
        .sheet(item: Binding(
            get: { push.openOrder.map(OrderRef.init) },
            set: { push.openOrder = $0?.id }
        )) { ref in
            NavigationStack {
                AdminOrderDetailView(number: ref.id)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Готово") { push.openOrder = nil } }
                    }
            }
        }
        .onChange(of: push.openOrder) { _, number in
            if number != nil { tab = 1 }
        }
    }
}

struct NoAccessView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        ContentUnavailableView {
            Label("Нет доступа", systemImage: "lock")
        } description: {
            Text("Приложение CHEBU только для сотрудников магазина.")
        } actions: {
            Button("Выйти") { Task { await auth.logout() } }.buttonStyle(.borderedProminent)
        }
    }
}
