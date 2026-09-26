import SwiftUI

struct OrdersFilter: Hashable {
    let status: OrderStatus?
}

struct AdminHomeView: View {
    @State private var stats: AdminStats?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let s = stats {
                    let review = s.byStatus[OrderStatus.PAYMENT_REVIEW.rawValue] ?? 0
                    if review > 0 {
                        Section {
                            NavigationLink(value: OrdersFilter(status: .PAYMENT_REVIEW)) {
                                Label("Чеков на проверке: \(review)", systemImage: "doc.text.magnifyingglass")
                                    .foregroundStyle(.orange)
                                    .fontWeight(.semibold)
                            }
                        }
                    }
                    Section("Выручка") {
                        revenueRow("Сегодня", s.revenue["day"])
                        revenueRow("7 дней", s.revenue["week"])
                        revenueRow("30 дней", s.revenue["month"])
                        LabeledContent("Покупатели", value: "\(s.customers)")
                        LabeledContent("Мало на складе", value: "\(s.lowStock)")
                    }
                    Section("Заказы по статусам") {
                        ForEach(OrderStatus.allCases) { st in
                            NavigationLink(value: OrdersFilter(status: st)) {
                                HStack {
                                    StatusBadge(status: st)
                                    Spacer()
                                    Text("\(s.byStatus[st.rawValue] ?? 0)").foregroundStyle(.secondary).monospacedDigit()
                                }
                            }
                        }
                    }
                } else if let error {
                    Text(error).foregroundStyle(.secondary)
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Сводка")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { BrandLogo(size: 32) } }
            .navigationDestination(for: OrdersFilter.self) { AdminOrdersView(status: $0.status) }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func revenueRow(_ title: String, _ b: RevenueBucket?) -> some View {
        LabeledContent(title) {
            VStack(alignment: .trailing) {
                Text(Format.rub(b?.sum ?? 0)).fontWeight(.semibold).foregroundStyle(.primary).monospacedDigit()
                Text("\(b?.count ?? 0) заказов").font(.caption)
            }
        }
    }

    private func load() async {
        do {
            stats = try await APIClient.shared.get("/admin/stats")
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

struct OrderRow: View {
    let order: Order

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
                Text("\(order.contactName) · \(order.contactPhone)")
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                HStack {
                    StatusBadge(status: order.status)
                    Spacer()
                    Text(Format.dateTime(order.createdAt)).font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

struct AdminOrdersView: View {
    @State var status: OrderStatus?
    @State private var orders: [Order] = []
    @State private var total = 0
    @State private var query = ""
    @State private var loading = true

    var body: some View {
        List {
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filterChip(nil)
                        ForEach(OrderStatus.allCases) { filterChip($0) }
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
            }
            Section {
                ForEach(orders) { o in
                    NavigationLink(value: o) { OrderRow(order: o) }
                }
            } footer: {
                if !loading { Text("Всего: \(total)") }
            }
        }
        .listStyle(.insetGrouped)
        .overlay { if loading && orders.isEmpty { ProgressView() } }
        .navigationTitle(status?.title ?? "Заказы")
        .navigationDestination(for: Order.self) { AdminOrderDetailView(number: $0.number) }
        .searchable(text: $query, prompt: "Номер, имя, телефон, почта")
        .refreshable { await load() }
        .task(id: "\(status?.rawValue ?? "")|\(query)") {
            try? await Task.sleep(for: .milliseconds(query.isEmpty ? 0 : 350))
            guard !Task.isCancelled else { return }
            await load()
        }
    }

    private func filterChip(_ st: OrderStatus?) -> some View {
        Button {
            status = st
        } label: {
            Text(st?.title ?? "Все")
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 12).frame(height: 32)
                .foregroundStyle(status == st ? Color(.systemBackground) : .primary)
                .background(status == st ? Color.primary : Color(.secondarySystemFill), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        var comps = URLComponents()
        comps.queryItems = []
        if let status { comps.queryItems?.append(URLQueryItem(name: "status", value: status.rawValue)) }
        if !query.isEmpty { comps.queryItems?.append(URLQueryItem(name: "q", value: query)) }
        if let r: AdminOrdersEnvelope = try? await APIClient.shared.get("/admin/orders?\(comps.percentEncodedQuery ?? "")") {
            orders = r.orders
            total = r.total
        }
    }
}

struct AdminOrderDetailView: View {
    let number: Int
    @State private var detail: AdminOrderDetail?
    @State private var error: String?
    @State private var busy = false
    @State private var confirmApprove = false
    @State private var showReject = false
    @State private var rejectReason = ""
    @State private var target: OrderStatus?
    @State private var note = ""
    @State private var tracking = ""
    @State private var pickup = ""
    @State private var adminComment = ""

    private let reasons = ["Платёж не найден", "Сумма не совпадает с суммой заказа", "Чек не читается", "Оплата не на те реквизиты"]

    var body: some View {
        List {
            if let d = detail {
                let o = d.order
                Section {
                    HStack {
                        StatusBadge(status: o.status)
                        Spacer()
                        Text(Format.rub(o.total)).font(.title3.weight(.bold)).monospacedDigit()
                    }
                    Text("Создан \(Format.dateTime(o.createdAt))" + (o.paidAt.map { " · оплачен \(Format.dateTime($0))" } ?? ""))
                        .font(.footnote).foregroundStyle(.secondary)
                }

                if o.status == .PAYMENT_REVIEW {
                    Section {
                        Button {
                            confirmApprove = true
                        } label: {
                            Label("Оплата получена", systemImage: "checkmark.circle.fill").frame(maxWidth: .infinity)
                        }
                        .tint(.green)
                        .fontWeight(.semibold)
                        Button(role: .destructive) {
                            showReject = true
                        } label: {
                            Label("Отклонить чек", systemImage: "xmark.circle").frame(maxWidth: .infinity)
                        }
                    } footer: {
                        Text("Сверьте поступление \(Format.rub(o.total)) в банке перед подтверждением.")
                    }
                }

                if !o.receipts.isEmpty {
                    Section("Чеки (\(o.receipts.count))") {
                        ForEach(o.receipts.reversed()) { r in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(Format.dateTime(r.createdAt) + (r.approved == true ? " · принят" : r.approved == false ? " · отклонён: \(r.note)" : " · ожидает проверки"))
                                    .font(.footnote).foregroundStyle(.secondary)
                                ProtectedImage(path: "/admin/receipts/\(r.id)")
                            }
                        }
                    }
                }

                let moves = d.nextStatuses.filter { $0.status != .PAYMENT_REVIEW && $0.status != .AWAITING_PAYMENT }
                if !moves.isEmpty {
                    Section("Изменить статус") {
                        ForEach(moves, id: \.status) { m in
                            Button(role: m.status == .CANCELLED ? .destructive : nil) {
                                note = ""
                                tracking = o.trackingNumber
                                pickup = o.pickupInfo
                                target = m.status
                            } label: {
                                Text(m.status == .ASSEMBLING ? "Отметить оплаченным вручную" : "→ \(m.status.title)")
                            }
                            .tint(m.status == .CANCELLED ? .red : .blue)
                        }
                    }
                }

                Section("Покупатель") {
                    VStack(alignment: .leading) {
                        Text(o.contactName)
                        if let tel = URL(string: "tel:\(o.contactPhone.filter { $0.isNumber || $0 == "+" })") {
                            Link(o.contactPhone, destination: tel).font(.subheadline)
                        }
                    }
                    LabeledContent("Аккаунт", value: d.customer.displayName)
                    if let u = d.customer.telegramUsername, let url = URL(string: "https://t.me/\(u)") {
                        Link("Написать @\(u)", destination: url)
                    }
                    if let e = d.customer.email { LabeledContent("Почта", value: e) }
                }

                Section("Доставка · \(o.deliveryMethod.title)") {
                    Text(o.deliveryAddress.isEmpty ? "—" : o.deliveryAddress).font(.subheadline)
                    if !o.customerComment.isEmpty { Text("Комментарий: \(o.customerComment)").font(.subheadline).foregroundStyle(.secondary) }
                    if !o.trackingNumber.isEmpty { CopyRow(label: "Трек-номер", value: o.trackingNumber) }
                }

                Section("Состав") {
                    ForEach(o.items) { i in
                        HStack {
                            RemoteImage(path: i.image).frame(width: 40, height: 50).clipShape(RoundedRectangle(cornerRadius: 6))
                            VStack(alignment: .leading) {
                                Text(i.productTitle).lineLimit(2)
                                Text("\(i.size)\(i.color.isEmpty ? "" : " · \(i.color)") · \(i.quantity) × \(Format.rub(i.unitPrice))")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    LabeledContent("Доставка", value: Format.rub(o.deliveryPrice))
                }

                Section {
                    TextField("Видна только сотрудникам", text: $adminComment, axis: .vertical).lineLimit(2...6)
                    if adminComment != (o.adminComment ?? "") {
                        Button("Сохранить заметку") { Task { await saveComment() } }
                    }
                } header: {
                    Text("Заметка для команды")
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
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Заказ №\(number)")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(busy)
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog("Подтвердить получение оплаты?", isPresented: $confirmApprove, titleVisibility: .visible) {
            Button("Оплата получена") { Task { await act("/admin/orders/\(number)/approve", [:]) } }
        }
        .sheet(isPresented: $showReject) { rejectSheet }
        .sheet(item: $target) { st in statusSheet(st) }
        .errorAlert($error)
    }

    private var rejectSheet: some View {
        NavigationStack {
            Form {
                Section("Причина") {
                    ForEach(reasons, id: \.self) { r in
                        Button {
                            rejectReason = r
                        } label: {
                            HStack {
                                Text(r).foregroundStyle(.primary)
                                Spacer()
                                if rejectReason == r { Image(systemName: "checkmark").foregroundStyle(.blue) }
                            }
                        }
                    }
                    TextField("Своя причина — её увидит покупатель", text: $rejectReason, axis: .vertical)
                }
            }
            .navigationTitle("Отклонить чек")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { showReject = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Отклонить") {
                        showReject = false
                        Task { await act("/admin/orders/\(number)/reject", ["reason": rejectReason]) }
                    }
                    .disabled(rejectReason.trimmingCharacters(in: .whitespaces).count < 3)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func statusSheet(_ st: OrderStatus) -> some View {
        NavigationStack {
            Form {
                if st == .SHIPPED { TextField("Трек-номер (необязательно)", text: $tracking) }
                if st == .READY_FOR_PICKUP { TextField("Где и когда забрать, код получения", text: $pickup, axis: .vertical).lineLimit(2...5) }
                Section {
                    TextField("Сообщение покупателю (необязательно)", text: $note, axis: .vertical).lineLimit(2...5)
                } footer: {
                    Text("Покупатель получит уведомление в Telegram и на почту.")
                }
            }
            .navigationTitle(st.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { target = nil } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(st == .CANCELLED ? "Отменить заказ" : "Применить") {
                        var body: [String: Any] = ["to": st.rawValue, "note": note]
                        if st == .SHIPPED { body["trackingNumber"] = tracking }
                        if st == .READY_FOR_PICKUP { body["pickupInfo"] = pickup }
                        target = nil
                        Task { await act("/admin/orders/\(number)/status", body) }
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func load() async {
        do {
            let d: AdminOrderDetail = try await APIClient.shared.get("/admin/orders/\(number)")
            detail = d
            adminComment = d.order.adminComment ?? ""
        } catch { self.error = error.localizedDescription }
    }

    private func act(_ path: String, _ body: [String: Any]) async {
        busy = true
        defer { busy = false }
        do {
            let _: OK = try await APIClient.shared.post(path, body)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            await load()
        } catch { self.error = error.localizedDescription }
    }

    private func saveComment() async {
        do {
            let _: OK = try await APIClient.shared.patch("/admin/orders/\(number)", ["adminComment": adminComment])
            await load()
        } catch { self.error = error.localizedDescription }
    }
}