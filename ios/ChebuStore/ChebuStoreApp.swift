import SwiftUI

@main
struct ChebuStoreApp: App {
    @State private var auth = AuthStore()
    @State private var cart = CartStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(cart)
                .tint(.primary)
                .task { await auth.bootstrap() }
        }
    }
}

struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(CartStore.self) private var cart
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = 0
    @State private var privacyCover = false

    var body: some View {
        Group {
            if !auth.ready {
                ProgressView()
            } else {
                TabView(selection: $tab) {
                    CatalogView()
                        .tabItem { Label("Каталог", systemImage: "square.grid.2x2") }
                        .tag(0)
                    CartView(switchToCatalog: { tab = 0 })
                        .tabItem { Label("Корзина", systemImage: "bag") }
                        .badge(cart.count)
                        .tag(1)
                    OrdersView()
                        .tabItem { Label("Заказы", systemImage: "list.bullet.rectangle") }
                        .tag(2)
                    ProfileView()
                        .tabItem { Label("Профиль", systemImage: "person") }
                        .tag(3)
                    if auth.user?.isStaff == true {
                        AdminHomeView()
                            .tabItem { Label("Админка", systemImage: "shield") }
                            .tag(4)
                    }
                }
            }
        }
        .overlay {
            // Hides payment details and customer data in the app switcher snapshot.
            if privacyCover {
                Rectangle().fill(.background).ignoresSafeArea().overlay(Text("ЧЕБУ").font(.largeTitle.weight(.heavy)))
            }
        }
        .onChange(of: scenePhase) { _, phase in privacyCover = phase != .active }
        .onChange(of: auth.user?.id) { _, id in
            Task {
                if id != nil { await cart.refresh() } else { cart.clearLocal() }
            }
            if auth.user?.isStaff != true, tab == 4 { tab = 0 }
        }
    }
}
