import SwiftUI

struct CartView: View {
    var switchToCatalog: () -> Void
    @Environment(AuthStore.self) private var auth
    @Environment(CartStore.self) private var cart
    @State private var error: String?
    @State private var showLogin = false
    @State private var checkout = false

    var body: some View {
        NavigationStack {
            Group {
                if auth.user == nil {
                    ContentUnavailableView {
                        Label("Войдите, чтобы собрать корзину", systemImage: "bag")
                    } description: {
                        Text("Корзина синхронизируется между сайтом, Telegram и приложением.")
                    } actions: {
                        Button("Войти") { showLogin = true }.buttonStyle(.borderedProminent)
                    }
                } else if let c = cart.cart, !c.items.isEmpty {
                    list(c)
                } else {
                    ContentUnavailableView {
                        Label("В корзине пусто", systemImage: "bag")
                    } actions: {
                        Button("В каталог", action: switchToCatalog).buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("Корзина")
            .navigationDestination(isPresented: $checkout) { CheckoutView() }
            .refreshable { await cart.refresh() }
            .task { if auth.user != nil { await cart.refresh() } }
            .sheet(isPresented: $showLogin) { LoginView() }
            .errorAlert($error)
        }
    }

    private func list(_ c: Cart) -> some View {
        let hasIssues = c.items.contains { $0.issue != nil }
        return List {
            Section {
                ForEach(c.items) { line in
                    HStack(alignment: .top, spacing: 12) {
                        RemoteImage(path: line.image)
                            .frame(width: 60, height: 75)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(line.productTitle).lineLimit(2)
                            Text([line.size, line.color].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.subheadline).foregroundStyle(.secondary)
                            if let issue = line.issue {
                                Text(issue).font(.footnote).foregroundStyle(.red)
                            }
                            HStack {
                                Text(Format.rub(line.unitPrice * line.quantity)).fontWeight(.semibold).monospacedDigit()
                                Spacer()
                                if line.purchasable {
                                    Stepper("", value: Binding(
                                        get: { line.quantity },
                                        set: { q in Task { await setQty(line.variantId, q) } }
                                    ), in: 0...max(line.maxQuantity, 1))
                                    .labelsHidden()
                                }
                            }
                        }
                    }
                    .swipeActions {
                        Button("Удалить", role: .destructive) { Task { await setQty(line.variantId, 0) } }
                    }
                }
            }
            Section {
                LabeledContent("Товары", value: "\(c.count) шт.")
                LabeledContent {
                    Text(Format.rub(c.itemsTotal)).fontWeight(.semibold)
                } label: {
                    Text("Итого").fontWeight(.semibold)
                }
            } footer: {
                Text("Стоимость доставки рассчитается при оформлении.")
            }
        }
        .listStyle(.insetGrouped)
        .safeAreaInset(edge: .bottom) {
            Button(hasIssues ? "Уберите недоступные товары" : "Оформить · \(Format.rub(c.itemsTotal))") { checkout = true }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(hasIssues)
                .padding(.horizontal)
                .padding(.vertical, 10)
                .background(.bar)
        }
    }

    private func setQty(_ variantId: String, _ q: Int) async {
        do { try await cart.setQuantity(variantId: variantId, quantity: q) } catch { self.error = error.localizedDescription }
    }
}
