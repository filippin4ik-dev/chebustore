import Foundation
import Observation

@MainActor
@Observable
final class CartStore {
    var cart: Cart?
    var count: Int { cart?.count ?? 0 }

    func refresh() async {
        cart = try? await APIClient.shared.get("/cart")
    }

    func setQuantity(variantId: String, quantity: Int) async throws {
        cart = try await APIClient.shared.put("/cart/items", ["variantId": variantId, "quantity": quantity])
    }

    func quantity(of variantId: String) -> Int {
        cart?.items.first(where: { $0.variantId == variantId })?.quantity ?? 0
    }

    func clearLocal() { cart = nil }
}
