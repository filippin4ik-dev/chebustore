import SwiftUI

@main
struct ChebuStoreApp: App {
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
        .onChange(of: scenePhase) { _, phase in privacyCover = phase != .active }
    }
}

struct AdminTabs: View {
    @State private var tab = 0

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
