import SwiftUI

struct CheckoutView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(CartStore.self) private var cart
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var phone = ""
    @State private var method: DeliveryMethod = .PICKUP
    @State private var address = ""
    @State private var comment = ""
    @State private var submitting = false
    @State private var error: String?
    @State private var createdOrder: Order?

    private var options: [DeliveryOption] { auth.config?.delivery ?? [] }
    private var deliveryPrice: Int { options.first { $0.method == method }?.price ?? 0 }
    private var total: Int { (cart.cart?.itemsTotal ?? 0) + deliveryPrice }

    var body: some View {
        Form {
            Section("Получатель") {
                TextField("Имя и фамилия", text: $name).textContentType(.name)
                TextField("Телефон", text: $phone).textContentType(.telephoneNumber).keyboardType(.phonePad)
            }
            Section("Доставка") {
                if options.count > 1 {
                    Picker("Способ", selection: $method) {
                        ForEach(options, id: \.method) { Text($0.method.title).tag($0.method) }
                    }
                    .pickerStyle(.segmented)
                }
                LabeledContent(method.title, value: deliveryPrice > 0 ? Format.rub(deliveryPrice) : "Бесплатно")
                if method == .PICKUP {
                    if let a = auth.config?.pickupAddress, !a.isEmpty { Text(a).font(.subheadline).foregroundStyle(.secondary) }
                } else {
                    TextField(method == .POST ? "Город, адрес ПВЗ или индекс и адрес" : "Город, улица, дом, квартира", text: $address, axis: .vertical)
                        .lineLimit(2...5)
                        .textContentType(.fullStreetAddress)
                }
            }
            Section("Комментарий") {
                TextField("Необязательно", text: $comment, axis: .vertical).lineLimit(1...4)
            }
            Section {
                LabeledContent("Товары", value: Format.rub(cart.cart?.itemsTotal ?? 0))
                LabeledContent("Доставка", value: Format.rub(deliveryPrice))
                LabeledContent {
                    Text(Format.rub(total)).fontWeight(.semibold)
                } label: {
                    Text("К оплате").fontWeight(.semibold)
                }
            } footer: {
                Text("После оформления появятся реквизиты для перевода по СБП или на карту. Оплатите и прикрепите чек — мы проверим поступление и начнём собирать заказ.")
            }
        }
        .navigationTitle("Оформление")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            Button {
                Task { await submit() }
            } label: {
                if submitting { ProgressView().tint(Color(.systemBackground)) } else { Text("Оформить заказ · \(Format.rub(total))") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(submitting || name.count < 2 || phone.count < 10)
            .padding(.horizontal)
            .padding(.vertical, 10)
            .background(.bar)
        }
        .onAppear {
            if name.isEmpty { name = [auth.user?.firstName, auth.user?.lastName].compactMap { $0 }.joined(separator: " ") }
            if phone.isEmpty { phone = auth.user?.phone ?? "" }
            if let first = options.first, !options.contains(where: { $0.method == method }) { method = first.method }
        }
        .navigationDestination(item: $createdOrder) { OrderDetailView(number: $0.number, initial: $0) }
        .errorAlert($error)
    }

    private func submit() async {
        submitting = true
        defer { submitting = false }
        do {
            let r: OrderEnvelope = try await APIClient.shared.post("/orders", [
                "contactName": name,
                "contactPhone": phone,
                "deliveryMethod": method.rawValue,
                "deliveryAddress": method == .PICKUP ? "" : address,
                "comment": comment,
            ])
            await cart.refresh()
            createdOrder = r.order
        } catch {
            self.error = error.localizedDescription
        }
    }
}
