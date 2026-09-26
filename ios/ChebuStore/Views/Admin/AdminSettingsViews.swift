import SwiftUI

struct AdminMoreView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.openURL) private var openURL
    @State private var confirmLogout = false
    @State private var testing = false
    @State private var testSent = false
    @State private var error: String?
    private let push = PushManager.shared

    private var pushStatusText: String {
        switch push.status {
        case .authorized, .provisional, .ephemeral: "Включены"
        case .denied: "Выключены"
        default: "Не настроены"
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if let user = auth.user {
                    Section {
                        HStack(spacing: 14) {
                            BrandLogo(size: 52)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(user.displayName).font(.title3.weight(.semibold))
                                Text(user.role.title).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Управление") {
                    NavigationLink { AdminSettingsView() } label: { Label("Магазин и реквизиты", systemImage: "gearshape") }
                    NavigationLink { AdminUsersView() } label: { Label("Пользователи", systemImage: "person.2") }
                }
                Section {
                    LabeledContent {
                        Text(pushStatusText)
                    } label: {
                        Label("Уведомления", systemImage: "bell.badge")
                    }
                    if push.status == .denied {
                        Button("Включить в настройках iPhone") {
                            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                        }
                    } else if push.status == .notDetermined {
                        Button("Включить уведомления") { Task { await push.enable() } }
                    } else {
                        Button {
                            Task { await sendTest() }
                        } label: {
                            HStack {
                                Text("Отправить тестовое уведомление")
                                if testing { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(testing)
                    }
                } header: {
                    Text("Уведомления")
                } footer: {
                    Text(push.registrationError.map { "iPhone не выдал токен уведомлений: \($0)" }
                        ?? "Новые заказы, чеки на проверку и отмены. На экране блокировки видны только номер заказа и сумма.")
                }
                Section("Безопасность") {
                    NavigationLink { SessionsView() } label: { Label("Устройства и сеансы", systemImage: "lock.shield") }
                }
                Section {
                    Link(destination: AppConfig.baseURL) { Label("Открыть сайт", systemImage: "safari") }
                }
                Section {
                    Button("Выйти", role: .destructive) { confirmLogout = true }.frame(maxWidth: .infinity)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Ещё")
            .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("Выйти", role: .destructive) { Task { await auth.logout() } }
            }
            .task { await push.refreshStatus() }
            .errorAlert($error)
            .sensoryFeedback(.success, trigger: testSent)
        }
    }

    private func sendTest() async {
        testing = true
        defer { testing = false }
        do {
            try await push.sendTest()
            testSent.toggle()
        } catch { self.error = error.localizedDescription }
    }
}

struct SessionsView: View {
    @State private var sessions: [SessionInfo] = []
    @State private var error: String?

    var body: some View {
        List {
            Section {
                ForEach(sessions) { s in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.title + (s.current ? " · это устройство" : ""))
                        Text("Активность \(Format.dateTime(s.lastSeenAt))\(s.ip.map { " · \($0)" } ?? "")")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .swipeActions {
                        if !s.current {
                            Button("Завершить", role: .destructive) { Task { await revoke(s.id) } }
                        }
                    }
                }
            } footer: {
                Text("Если видите незнакомое устройство — завершите его сеанс.")
            }
            if sessions.count > 1 {
                Section {
                    Button("Завершить все другие сеансы", role: .destructive) { Task { await revokeOthers() } }
                }
            }
        }
        .navigationTitle("Устройства")
        .task { await load() }
        .refreshable { await load() }
        .errorAlert($error)
    }

    private func load() async {
        do {
            let r: SessionsEnvelope = try await APIClient.shared.get("/account/sessions")
            sessions = r.sessions
        } catch { self.error = error.localizedDescription }
    }

    private func revoke(_ id: String) async {
        let _: OK? = try? await APIClient.shared.delete("/account/sessions/\(id)")
        await load()
    }

    private func revokeOthers() async {
        let _: OK? = try? await APIClient.shared.post("/account/sessions/revoke-others")
        await load()
    }
}

struct AdminSettingsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var store: StoreSettings?
    @State private var payment: PaymentSettings?
    @State private var prices: [String: String] = [:]
    @State private var error: String?
    @State private var saved = false

    private var isAdmin: Bool { auth.user?.role == .ADMIN }
    private var banks: [Bank] { auth.config?.banks ?? [] }

    var body: some View {
        Form {
            if isAdmin, let p = payment {
                Section {
                    if p.sbpPhone.trimmingCharacters(in: .whitespaces).isEmpty && p.cardNumber.trimmingCharacters(in: .whitespaces).isEmpty {
                        Label("Реквизиты не заполнены — покупатели не смогут оформить заказ.", systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline).foregroundStyle(.orange)
                    }
                    TextField("СБП: телефон", text: bindPayment(\.sbpPhone)).keyboardType(.phonePad)
                    BankPickerRow(title: "Банк СБП", banks: banks, selection: bindPayment(\.sbpBank))
                    TextField("Номер карты", text: bindPayment(\.cardNumber)).keyboardType(.numberPad)
                    BankPickerRow(title: "Банк карты", banks: banks, selection: bindPayment(\.cardBank))
                    TextField("Получатель", text: bindPayment(\.recipientName))
                    Stepper("Срок оплаты: \(p.paymentWindowHours) ч", value: Binding(
                        get: { payment?.paymentWindowHours ?? 24 },
                        set: { payment?.paymentWindowHours = $0 }
                    ), in: 1...168)
                    TextField("Инструкция покупателю", text: bindPayment(\.instructions), axis: .vertical).lineLimit(2...5)
                    Button("Сохранить реквизиты") { Task { await savePayment() } }
                } header: {
                    Text("Реквизиты для оплаты")
                } footer: {
                    Text("Хранятся только на сервере и показываются покупателю внутри его неоплаченного заказа. Изменения фиксируются в журнале.")
                }
            }

            if let store {
                Section("Магазин") {
                    TextField("Название", text: bindStore(\.storeName))
                    TextField("Поддержка в Telegram (@username)", text: bindStore(\.supportTelegram))
                    TextField("Почта поддержки", text: bindStore(\.supportEmail)).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                }
                .disabled(!isAdmin)

                Section {
                    ForEach(DeliveryMethod.allCases) { m in
                        HStack(spacing: 12) {
                            Image(systemName: m.icon).frame(width: 24).foregroundStyle(.secondary)
                            Text(m.title)
                            Spacer()
                            TextField("0", text: Binding(
                                get: { prices[m.rawValue] ?? "" },
                                set: { prices[m.rawValue] = $0 }
                            ))
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 70)
                            .padding(.vertical, 6).padding(.horizontal, 8)
                            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .disabled(!(store.deliveryEnabled[m.rawValue] ?? true))
                            Text("₽").foregroundStyle(.secondary)
                            Toggle("", isOn: Binding(
                                get: { store.deliveryEnabled[m.rawValue] ?? true },
                                set: { self.store?.deliveryEnabled[m.rawValue] = $0 }
                            ))
                            .labelsHidden()
                        }
                    }
                    TextField("Где и когда передаёте лично", text: bindStore(\.pickupAddress), axis: .vertical).lineLimit(2...4)
                } header: {
                    Text("Доставка")
                } footer: {
                    Text("Цена 0 — бесплатно. Выключенный способ не показывается покупателям.")
                }
                .disabled(!isAdmin)

                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 14) {
                            ForEach(ThemePreset.all) { t in
                                let active = t.light.caseInsensitiveCompare(store.accentLight) == .orderedSame
                                    && t.dark.caseInsensitiveCompare(store.accentDark) == .orderedSame
                                PresetSwatch(name: t.name, light: t.light, dark: t.dark, active: active) {
                                    self.store?.accentLight = t.light
                                    self.store?.accentDark = t.dark
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    ColorPicker("Светлая тема", selection: colorBinding(\.accentLight), supportsOpacity: false)
                    ColorPicker("Тёмная тема", selection: colorBinding(\.accentDark), supportsOpacity: false)
                } header: {
                    Text("Оформление")
                } footer: {
                    Text("Цвет кнопок и акцентов на сайте, в Telegram и в этом приложении.")
                }
                .disabled(!isAdmin)

                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 14) {
                            ForEach(BackgroundPreset.all) { t in
                                let active = t.light.caseInsensitiveCompare(store.bgLight) == .orderedSame
                                    && t.dark.caseInsensitiveCompare(store.bgDark) == .orderedSame
                                PresetSwatch(name: t.name, light: t.light, dark: t.dark, active: active) {
                                    self.store?.bgLight = t.light
                                    self.store?.bgDark = t.dark
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    ColorPicker("Светлая тема", selection: colorBinding(\.bgLight), supportsOpacity: false)
                    ColorPicker("Тёмная тема", selection: colorBinding(\.bgDark), supportsOpacity: false)
                    HStack(spacing: 12) {
                        ThemeMock(bg: store.bgLight, surface: "#FFFFFF", label: .black, accent: store.accentLight)
                        ThemeMock(bg: store.bgDark, surface: "#1C1C1E", label: .white, accent: store.accentDark)
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("Фон магазина")
                } footer: {
                    if let warning = backgroundWarning(store) {
                        Text(warning).foregroundStyle(.red)
                    } else {
                        Text("Цвет фона страниц на сайте и в Telegram. Карточки остаются белыми днём и тёмными ночью.")
                    }
                }
                .disabled(!isAdmin)

                Section {
                    TextField("Текст приветствия", text: bindStore(\.botWelcome), axis: .vertical).lineLimit(4...12)
                    TextField("Текст кнопки", text: bindStore(\.botButton))
                } header: {
                    Text("Приветствие бота")
                } footer: {
                    Text("Бот отправляет это сообщение на /start. Кнопка открывает магазин.")
                }
                .disabled(!isAdmin)

                if isAdmin {
                    Section { Button("Сохранить настройки магазина") { Task { await saveStore() } } }
                } else {
                    Section { Text("Изменять настройки может только администратор.").foregroundStyle(.secondary) }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Настройки")
        .task { await load() }
        .errorAlert($error)
        .sensoryFeedback(.success, trigger: saved)
    }

    private func bindPayment(_ kp: WritableKeyPath<PaymentSettings, String>) -> Binding<String> {
        Binding(get: { payment?[keyPath: kp] ?? "" }, set: { payment?[keyPath: kp] = $0 })
    }

    private func bindStore(_ kp: WritableKeyPath<StoreSettings, String>) -> Binding<String> {
        Binding(get: { store?[keyPath: kp] ?? "" }, set: { store?[keyPath: kp] = $0 })
    }

    private func colorBinding(_ kp: WritableKeyPath<StoreSettings, String>) -> Binding<Color> {
        Binding(
            get: { Color(hex: store?[keyPath: kp] ?? "#000000") },
            set: { store?[keyPath: kp] = $0.hexString }
        )
    }

    private func backgroundWarning(_ s: StoreSettings) -> String? {
        var parts: [String] = []
        if let c = UIColor(hex: s.bgLight), c.luminance < BackgroundPreset.lightMin {
            parts.append("Фон светлой темы слишком тёмный — выберите цвет светлее.")
        }
        if let c = UIColor(hex: s.bgDark), c.luminance > BackgroundPreset.darkMax {
            parts.append("Фон тёмной темы слишком светлый — выберите цвет темнее.")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    private func load() async {
        do {
            let r: SettingsEnvelope = try await APIClient.shared.get("/admin/settings")
            store = r.store
            payment = r.payment
            prices = r.store.deliveryPrices.mapValues { Format.rubles($0) }
            if auth.config == nil { await auth.refreshConfig() }
        } catch { self.error = error.localizedDescription }
    }

    private func savePayment() async {
        guard let p = payment else { return }
        do {
            let _: [String: PaymentSettings] = try await APIClient.shared.put("/admin/settings/payment", [
                "sbpPhone": p.sbpPhone, "sbpBank": p.sbpBank, "cardNumber": p.cardNumber, "cardBank": p.cardBank,
                "recipientName": p.recipientName, "instructions": p.instructions, "paymentWindowHours": p.paymentWindowHours,
            ])
            saved.toggle()
        } catch { self.error = error.localizedDescription }
    }

    private func saveStore() async {
        guard let s = store else { return }
        var deliveryPrices: [String: Int] = [:]
        for m in DeliveryMethod.allCases { deliveryPrices[m.rawValue] = Format.kopecks(prices[m.rawValue] ?? "") ?? 0 }
        do {
            let _: [String: StoreSettings] = try await APIClient.shared.put("/admin/settings/store", [
                "storeName": s.storeName, "supportTelegram": s.supportTelegram, "supportEmail": s.supportEmail,
                "pickupAddress": s.pickupAddress, "deliveryPrices": deliveryPrices, "deliveryEnabled": s.deliveryEnabled,
                "accentLight": s.accentLight, "accentDark": s.accentDark, "bgLight": s.bgLight, "bgDark": s.bgDark, "botWelcome": s.botWelcome, "botButton": s.botButton,
            ])
            await auth.refreshConfig()
            saved.toggle()
        } catch { self.error = error.localizedDescription }
    }
}

struct PresetSwatch: View {
    let name: String
    let light: String
    let dark: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                HStack(spacing: 0) {
                    Color(hex: light).frame(width: 18)
                    Color(hex: dark).frame(width: 18)
                }
                .frame(width: 36, height: 36)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(Color(.separator), lineWidth: 0.5))
                .padding(3)
                .overlay(Circle().strokeBorder(active ? Color.primary : .clear, lineWidth: 2))
                Text(name).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }
}

struct ThemeMock: View {
    let bg: String
    let surface: String
    let label: Color
    let accent: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("CHEBU").font(.headline).foregroundStyle(label)
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 6).fill(Color.gray.opacity(0.2)).frame(height: 40)
                Capsule().fill(label.opacity(0.8)).frame(width: 70, height: 6)
                Capsule().fill(label.opacity(0.35)).frame(width: 40, height: 6)
                Text("В корзину")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color.onAccent(ThemeColors(accentLight: accent, accentDark: accent)))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Color(hex: accent), in: Capsule())
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hex: surface), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: bg), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color(.separator), lineWidth: 0.5))
    }
}

struct BankPickerRow: View {
    let title: String
    let banks: [Bank]
    @Binding var selection: String

    var body: some View {
        NavigationLink {
            BankListView(title: title, banks: banks, selection: $selection)
        } label: {
            HStack {
                Text(title)
                Spacer()
                if let bank = banks.first(where: { $0.id == selection }) {
                    BankAvatar(bank: bank, size: 24)
                    Text(bank.name).foregroundStyle(.secondary)
                } else {
                    Text("Не выбран").foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct BankListView: View {
    let title: String
    let banks: [Bank]
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [Bank] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? banks : banks.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        List {
            if !selection.isEmpty {
                Button("Не указывать") {
                    selection = ""
                    dismiss()
                }
                .foregroundStyle(.secondary)
            }
            ForEach(filtered) { bank in
                Button {
                    selection = bank.id
                    dismiss()
                } label: {
                    HStack(spacing: 12) {
                        BankAvatar(bank: bank, size: 32)
                        Text(bank.name).foregroundStyle(.primary)
                        Spacer()
                        if bank.id == selection { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                }
            }
        }
        .searchable(text: $query, prompt: "Поиск банка")
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AdminUsersView: View {
    @Environment(AuthStore.self) private var auth
    @State private var users: [AdminUser] = []
    @State private var query = ""
    @State private var selected: AdminUser?
    @State private var error: String?

    var body: some View {
        List(users) { u in
            Button { selected = u } label: {
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(u.displayName).foregroundStyle(.primary)
                        if u.isBlocked { Text("заблокирован").font(.caption.weight(.semibold)).foregroundStyle(.red) }
                    }
                    Text("\(u.role.title) · заказов: \(u.orderCount ?? 0)").font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Пользователи")
        .searchable(text: $query, prompt: "Почта, @username, имя, телефон")
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(query.isEmpty ? 0 : 350))
            guard !Task.isCancelled else { return }
            await load()
        }
        .sheet(item: $selected) { u in userSheet(u) }
        .errorAlert($error)
    }

    private func userSheet(_ u: AdminUser) -> some View {
        NavigationStack {
            Form {
                LabeledContent("Telegram", value: u.telegramUsername.map { "@\($0)" } ?? "—")
                LabeledContent("Почта", value: u.email ?? "—")
                LabeledContent("Телефон", value: u.phone ?? "—")
                LabeledContent("Регистрация", value: Format.dateTime(u.createdAt))
                if auth.user?.role == .ADMIN && u.id != auth.user?.id {
                    Section {
                        Picker("Роль", selection: Binding(get: { u.role }, set: { r in Task { await update(u, ["role": r.rawValue]) } })) {
                            Text(Role.CUSTOMER.title).tag(Role.CUSTOMER)
                            Text(Role.MANAGER.title).tag(Role.MANAGER)
                            Text(Role.ADMIN.title).tag(Role.ADMIN)
                        }
                    } footer: {
                        Text("Менеджер: заказы и товары. Администратор: плюс реквизиты, роли и журнал.")
                    }
                    Section {
                        Button(u.isBlocked ? "Разблокировать" : "Заблокировать", role: u.isBlocked ? nil : .destructive) {
                            Task { await update(u, ["isBlocked": !u.isBlocked]) }
                        }
                    }
                }
            }
            .navigationTitle(u.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { selected = nil } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func load() async {
        var comps = URLComponents()
        comps.queryItems = query.isEmpty ? [] : [URLQueryItem(name: "q", value: query)]
        if let r: AdminUsersEnvelope = try? await APIClient.shared.get("/admin/users?\(comps.percentEncodedQuery ?? "")") { users = r.users }
    }

    private func update(_ u: AdminUser, _ body: [String: Any]) async {
        do {
            let r: AdminUserEnvelope = try await APIClient.shared.patch("/admin/users/\(u.id)", body)
            selected = r.user
            await load()
        } catch { self.error = error.localizedDescription }
    }
}
