import SwiftUI

enum Role: String, Codable {
    case CUSTOMER, MANAGER, ADMIN

    var title: String {
        switch self {
        case .CUSTOMER: "Покупатель"
        case .MANAGER: "Менеджер"
        case .ADMIN: "Администратор"
        }
    }
}

enum OrderStatus: String, Codable, CaseIterable, Identifiable {
    case AWAITING_PAYMENT, PAYMENT_REVIEW, ASSEMBLING, SHIPPED, READY_FOR_PICKUP, COMPLETED, CANCELLED
    var id: String { rawValue }

    var title: String {
        switch self {
        case .AWAITING_PAYMENT: "Ожидает оплаты"
        case .PAYMENT_REVIEW: "Проверяем оплату"
        case .ASSEMBLING: "Собирается"
        case .SHIPPED: "В доставке"
        case .READY_FOR_PICKUP: "Можно забрать"
        case .COMPLETED: "Получен"
        case .CANCELLED: "Отменён"
        }
    }

    var color: Color {
        switch self {
        case .AWAITING_PAYMENT: .orange
        case .PAYMENT_REVIEW: .indigo
        case .ASSEMBLING: .blue
        case .SHIPPED: .teal
        case .READY_FOR_PICKUP: .green
        case .COMPLETED: .secondary
        case .CANCELLED: .red
        }
    }

    var step: Int {
        switch self {
        case .AWAITING_PAYMENT, .CANCELLED: 0
        case .PAYMENT_REVIEW: 1
        case .ASSEMBLING: 2
        case .SHIPPED: 3
        case .READY_FOR_PICKUP: 4
        case .COMPLETED: 5
        }
    }
}

enum DeliveryMethod: String, Codable, CaseIterable, Identifiable {
    case PICKUP, COURIER, POST
    var id: String { rawValue }

    var title: String {
        switch self {
        case .PICKUP: "Самовывоз"
        case .COURIER: "Курьер"
        case .POST: "Почта / ПВЗ"
        }
    }
}

struct User: Codable, Identifiable, Equatable {
    let id: String
    let email: String?
    let emailVerified: Bool
    let telegramId: String?
    let telegramUsername: String?
    let firstName: String?
    let lastName: String?
    let phone: String?
    let photoUrl: String?
    let role: Role
    let createdAt: Date

    var isStaff: Bool { role == .ADMIN || role == .MANAGER }
    var displayName: String {
        let name = [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        if !name.isEmpty { return name }
        if let telegramUsername { return "@\(telegramUsername)" }
        return email ?? "Покупатель"
    }
}

struct DeliveryOption: Codable, Hashable {
    let method: DeliveryMethod
    let price: Int
}

struct PublicConfig: Codable {
    let storeName: String
    let botUsername: String
    let supportTelegram: String
    let supportEmail: String
    let pickupAddress: String
    let delivery: [DeliveryOption]
}

struct Category: Codable, Identifiable, Hashable {
    let id: String
    let slug: String
    let name: String
}

struct ProductImage: Codable, Identifiable, Hashable {
    let id: String
    let url: String
    let width: Int
    let height: Int
}

struct Variant: Codable, Identifiable, Hashable {
    let id: String
    let size: String
    let color: String
    let price: Int
    let available: Bool
    let lowStock: Bool
}

struct Product: Codable, Identifiable, Hashable {
    let id: String
    let slug: String
    let title: String
    let description: String
    let category: Category?
    let price: Int
    let oldPrice: Int?
    let images: [ProductImage]
    let variants: [Variant]
    let available: Bool
}

struct CartLine: Codable, Identifiable, Hashable {
    let id: String
    let variantId: String
    let productSlug: String
    let productTitle: String
    let size: String
    let color: String
    let image: String?
    let unitPrice: Int
    let quantity: Int
    let maxQuantity: Int
    let purchasable: Bool
    let issue: String?
}

struct Cart: Codable {
    let items: [CartLine]
    let itemsTotal: Int
    let count: Int
}

struct PaymentDetails: Codable, Hashable {
    let sbpPhone: String
    let sbpBank: String
    let cardNumber: String
    let cardBank: String
    let recipientName: String
    let instructions: String
}

struct OrderItem: Codable, Identifiable, Hashable {
    let id: String
    let variantId: String?
    let productTitle: String
    let size: String
    let color: String
    let image: String?
    let unitPrice: Int
    let quantity: Int
}

struct OrderEvent: Codable, Hashable {
    let from: OrderStatus?
    let to: OrderStatus
    let note: String
    let createdAt: Date
}

struct Receipt: Codable, Identifiable, Hashable {
    let id: String
    let mimeType: String
    let createdAt: Date
    let approved: Bool?
    let note: String
}

struct Order: Codable, Identifiable, Hashable {
    let id: String
    let number: Int
    let status: OrderStatus
    let itemsTotal: Int
    let deliveryPrice: Int
    let total: Int
    let contactName: String
    let contactPhone: String
    let deliveryMethod: DeliveryMethod
    let deliveryAddress: String
    let customerComment: String
    let trackingNumber: String
    let pickupInfo: String
    let rejectReason: String
    let payment: PaymentDetails?
    let paymentDeadline: Date
    let paidAt: Date?
    let createdAt: Date
    let items: [OrderItem]
    let history: [OrderEvent]
    let receipts: [Receipt]
    let adminComment: String?
}

struct SessionInfo: Codable, Identifiable {
    let id: String
    let client: String
    let userAgent: String?
    let ip: String?
    let createdAt: Date
    let lastSeenAt: Date
    let current: Bool

    var title: String {
        switch client {
        case "MINIAPP": "Telegram Mini App"
        case "IOS": "Приложение iPhone"
        default: "Браузер"
        }
    }
}

// MARK: - Admin

struct AdminVariant: Codable, Identifiable, Hashable {
    var id: String
    var size: String
    var color: String
    var sku: String?
    var price: Int?
    var stock: Int
    var isActive: Bool
}

struct AdminProduct: Codable, Identifiable, Hashable {
    let id: String
    let slug: String
    let title: String
    let description: String
    let categoryId: String?
    let basePrice: Int
    let oldPrice: Int?
    let isActive: Bool
    let images: [ProductImage]
    let variants: [AdminVariant]
}

struct AdminCategory: Codable, Identifiable, Hashable {
    let id: String
    let slug: String
    let name: String
    let sortOrder: Int
    let isActive: Bool
    let productCount: Int
}

struct AdminUser: Codable, Identifiable, Hashable {
    let id: String
    let email: String?
    let telegramUsername: String?
    let firstName: String?
    let lastName: String?
    let phone: String?
    let role: Role
    let isBlocked: Bool
    let createdAt: Date
    let lastLoginAt: Date?
    let orderCount: Int?

    var displayName: String {
        let name = [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        if !name.isEmpty { return name }
        if let telegramUsername { return "@\(telegramUsername)" }
        return email ?? "Покупатель"
    }
}

struct PaymentSettings: Codable {
    var sbpPhone: String
    var sbpBank: String
    var cardNumber: String
    var cardBank: String
    var recipientName: String
    var instructions: String
    var paymentWindowHours: Int
}

struct StoreSettings: Codable {
    var storeName: String
    var supportTelegram: String
    var supportEmail: String
    var pickupAddress: String
    var deliveryPrices: [String: Int]
    var deliveryEnabled: [String: Bool]
}

struct RevenueBucket: Codable { let sum: Int; let count: Int }

struct AdminStats: Codable {
    let byStatus: [String: Int]
    let revenue: [String: RevenueBucket]
    let customers: Int
    let lowStock: Int
}

struct NextStatus: Codable, Hashable { let status: OrderStatus; let text: String }

struct AdminOrderDetail: Codable {
    let order: Order
    let customer: User
    let nextStatuses: [NextStatus]
}

// MARK: - Response envelopes

struct UserEnvelope: Decodable { let user: User? }
struct TokenEnvelope: Decodable { let user: User; let token: String }
struct ProductsEnvelope: Decodable { let products: [Product]; let total: Int; let page: Int; let pageSize: Int }
struct ProductEnvelope: Decodable { let product: Product }
struct CategoriesEnvelope: Decodable { let categories: [Category] }
struct OrdersEnvelope: Decodable { let orders: [Order] }
struct OrderEnvelope: Decodable { let order: Order }
struct SessionsEnvelope: Decodable { let sessions: [SessionInfo] }
struct ResendEnvelope: Decodable { let resendIn: Int }
struct AdminOrdersEnvelope: Decodable { let orders: [Order]; let total: Int }
struct AdminProductsEnvelope: Decodable { let products: [AdminProduct] }
struct AdminProductEnvelope: Decodable { let product: AdminProduct }
struct AdminCategoriesEnvelope: Decodable { let categories: [AdminCategory] }
struct AdminUsersEnvelope: Decodable { let users: [AdminUser]; let total: Int }
struct AdminUserEnvelope: Decodable { let user: AdminUser }
struct SettingsEnvelope: Decodable { let store: StoreSettings; let payment: PaymentSettings? }
