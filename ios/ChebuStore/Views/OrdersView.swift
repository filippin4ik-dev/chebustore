import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct OrdersView: View {
    @Environment(AuthStore.self) private var auth
    @State private var orders: [Order]?
    @State private var error: String?
    @State private var showLogin = false

    var body: some View {
        NavigationStack {
            Group {
                if auth.user == nil {
                    ContentUnavailableView {
                        Label("Войдите, чтобы видеть заказы", systemImage: "list.bullet.rectangle")
                    } actions: {
                        Button("Войти") { showLogin = true }.buttonStyle(.borderedProminent)
                    }
                } else if let orders {
                    if orders.isEmpty {
                        ContentUnavailableView("Заказов пока нет", systemImage: "shippingbox", description: Text("Здесь появятся ваши заказы и их статусы."))
                    } else {
                        List(orders) { o in
                            NavigationLink(value: o) { OrderRow(order: o) }
                        }
                        .listStyle(.insetGrouped)
                    }
                } else if let error {
                    ContentUnavailableView("Не получилось загрузить", systemImage: "wifi.exclamationmark", description: Text(error))
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Заказы")
            .navigationDestination(for: Order.self) { OrderDetailView(number: $0.number, initial: $0) }
            .refreshable { await load() }
            .task(id: auth.user?.id) { await load() }
            .sheet(isPresented: $showLogin) { LoginView() }
        }
    }

    private func load() async {
        guard auth.user != nil else { return }
        do {
            let r: OrdersEnvelope = try await APIClient.shared.get("/orders")
            orders = r.orders
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct OrderRow: View {
    let order: Order
    var showContact = false

    var body: some View {
        HStack(spacing: 12) {
            RemoteImage(path: order.items.first?.image)
                .frame(width: 48, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("№\(order.number)").fontWeight(.semibold)
                    Spacer()
                    Text(Format.rub(order.total)).fontWeight(.semibold).monospacedDigit()
                }
                Text(showContact ? "\(order.contactName) · \(order.contactPhone)" : "\(Format.date(order.createdAt)) · \(order.items.reduce(0) { $0 + $1.quantity }) шт.")
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                StatusBadge(status: order.status)
            }
        }
        .padding(.vertical, 2)
    }
}

struct OrderDetailView: View {
    let number: Int
    var initial: Order?

    @Environment(AuthStore.self) private var auth
    @State private var order: Order?
    @State private var error: String?
    @State private var photoItem: PhotosPickerItem?
    @State private var showPDF = false
    @State private var uploading = false
    @State private var confirmCancel = false
    @State private var showReceipts = false

    var body: some View {
        let o = order ?? initial
        List {
            if let o {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            StatusBadge(status: o.status)
                            Spacer()
                            Text(Format.dateTime(o.createdAt)).font(.footnote).foregroundStyle(.secondary)
                        }
                        if o.status != .CANCELLED {
                            HStack(spacing: 4) {
                                ForEach(1...5, id: \.self) { i in
                                    Capsule().fill(i <= o.status.step ? Color.primary : Color(.tertiarySystemFill)).frame(height: 4)
                                }
                            }
                        }
                        Text(statusHint(o)).font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                if o.status == .AWAITING_PAYMENT, !o.rejectReason.isEmpty {
                    Section {
                        Label("Чек отклонён: \(o.rejectReason). Проверьте перевод и прикрепите правильный чек.", systemImage: "exclamationmark.triangle")
                            .font(.subheadline)
                            .foregroundStyle(.red)
                    }
                }

                if let p = o.payment, o.status == .AWAITING_PAYMENT || o.status == .PAYMENT_REVIEW {
                    Section {
                        CopyRow(label: "Сумма к оплате", value: Format.rubles(o.total), display: Format.rub(o.total))
                        if !p.sbpPhone.isEmpty {
                            CopyRow(label: p.sbpBank.isEmpty ? "СБП" : "СБП · \(p.sbpBank)", value: p.sbpPhone.filter { $0.isNumber || $0 == "+" }, display: p.sbpPhone)
                        }
                        if !p.cardNumber.isEmpty {
                            CopyRow(label: p.cardBank.isEmpty ? "Карта" : "Карта · \(p.cardBank)", value: p.cardNumber.filter(\.isNumber), display: p.cardNumber)
                        }
                        LabeledContent("Получатель", value: p.recipientName)
                    } header: {
                        Text("Реквизиты для оплаты")
                    } footer: {
                        Text(p.instructions.isEmpty ? "Переведите точную сумму. В комментарии к переводу ничего писать не нужно." : p.instructions)
                    }

                    Section {
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            HStack {
                                Label(o.status == .PAYMENT_REVIEW ? "Добавить ещё чек" : "Я оплатил — прикрепить скриншот", systemImage: "photo")
                                Spacer()
                                if uploading { ProgressView() }
                            }
                        }
                        .disabled(uploading)
                        Button {
                            showPDF = true
                        } label: {
                            Label("Прикрепить PDF-квитанцию", systemImage: "doc")
                        }
                        .disabled(uploading)
                    } footer: {
                        Text("Скриншот из банковского приложения или PDF, до 10 МБ.")
                    }
                }

                if o.status == .SHIPPED, !o.trackingNumber.isEmpty {
                    Section { CopyRow(label: "Трек-номер", value: o.trackingNumber) }
                }
                if o.status == .READY_FOR_PICKUP, !o.pickupInfo.isEmpty {
                    Section("Где забрать") { Text(o.pickupInfo) }
                }

                Section("Состав") {
                    ForEach(o.items) { i in
                        HStack(spacing: 12) {
                            RemoteImage(path: i.image).frame(width: 44, height: 55).clipShape(RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading) {
                                Text(i.productTitle).lineLimit(2)
                                Text([i.size, i.color, "\(i.quantity) шт."].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Format.rub(i.unitPrice * i.quantity)).monospacedDigit()
                        }
                    }
                    LabeledContent("Доставка · \(o.deliveryMethod.title)", value: Format.rub(o.deliveryPrice))
                    LabeledContent {
                        Text(Format.rub(o.total)).fontWeight(.semibold)
                    } label: {
                        Text("Итого").fontWeight(.semibold)
                    }
                }

                Section("Получение") {
                    VStack(alignment: .leading) {
                        Text(o.contactName)
                        Text(o.contactPhone).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if !o.deliveryAddress.isEmpty { Text(o.deliveryAddress).font(.subheadline) }
                    if !o.customerComment.isEmpty { Text(o.customerComment).font(.subheadline).foregroundStyle(.secondary) }
                }

                if !o.receipts.isEmpty {
                    Section("Чеки") {
                        DisclosureGroup("Загружено: \(o.receipts.count)", isExpanded: $showReceipts) {
                            ForEach(o.receipts) { r in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(receiptCaption(r)).font(.footnote).foregroundStyle(.secondary)
                                    ProtectedImage(path: "/orders/\(o.number)/receipts/\(r.id)")
                                }
                            }
                        }
                    }
                }

                Section("История") {
                    ForEach(Array(o.history.reversed().enumerated()), id: \.offset) { _, h in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(h.to.title).font(.subheadline)
                            if !h.note.isEmpty { Text(h.note).font(.footnote).foregroundStyle(.secondary) }
                            Text(Format.dateTime(h.createdAt)).font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                }

                if o.status == .AWAITING_PAYMENT {
                    Section {
                        Button("Отменить заказ", role: .destructive) { confirmCancel = true }
                            .frame(maxWidth: .infinity)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Заказ №\(number)")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await uploadPhoto(item) }
        }
        .fileImporter(isPresented: $showPDF, allowedContentTypes: [.pdf]) { result in
            if case .success(let url) = result { Task { await uploadPDF(url) } }
        }
        .confirmationDialog("Отменить заказ? Товары вернутся в продажу.", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Отменить заказ", role: .destructive) { Task { await cancel() } }
        }
        .errorAlert($error)
    }

    private func statusHint(_ o: Order) -> String {
        switch o.status {
        case .AWAITING_PAYMENT: "Оплатите заказ в течение \(Format.timeLeft(o.paymentDeadline)) и прикрепите чек."
        case .PAYMENT_REVIEW: "Мы получили чек и сверяем поступление. Обычно это занимает до пары часов."
        case .ASSEMBLING: "Оплата получена. Собираем и упаковываем заказ."
        case .SHIPPED: "Заказ передан в доставку."
        case .READY_FOR_PICKUP: "Заказ прибыл — можно забирать."
        case .COMPLETED: "Заказ получен. Спасибо за покупку!"
        case .CANCELLED: "Заказ отменён."
        }
    }

    private func receiptCaption(_ r: Receipt) -> String {
        var s = Format.dateTime(r.createdAt)
        if r.approved == true { s += " · принят" }
        if r.approved == false { s += " · отклонён" + (r.note.isEmpty ? "" : ": \(r.note)") }
        return s
    }

    private func load() async {
        do {
            let r: OrderEnvelope = try await APIClient.shared.get("/orders/\(number)")
            order = r.order
        } catch {
            if order == nil && initial == nil { self.error = error.localizedDescription }
        }
    }

    private func uploadPhoto(_ item: PhotosPickerItem) async {
        uploading = true
        defer {
            uploading = false
            photoItem = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data),
                  let jpeg = image.jpegData(compressionQuality: 0.85) else {
                throw APIError(status: 0, code: "image", message: "Не удалось прочитать изображение")
            }
            let r: OrderEnvelope = try await APIClient.shared.upload("/orders/\(number)/receipt", data: jpeg, filename: "receipt.jpg", mimeType: "image/jpeg")
            order = r.order
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func uploadPDF(_ url: URL) async {
        uploading = true
        defer { uploading = false }
        do {
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            let r: OrderEnvelope = try await APIClient.shared.upload("/orders/\(number)/receipt", data: data, filename: "receipt.pdf", mimeType: "application/pdf")
            order = r.order
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func cancel() async {
        do {
            let r: OrderEnvelope = try await APIClient.shared.post("/orders/\(number)/cancel")
            order = r.order
        } catch {
            self.error = error.localizedDescription
        }
    }
}
