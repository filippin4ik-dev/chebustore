export type Role = "CUSTOMER" | "MANAGER" | "ADMIN";

export type OrderStatus =
  | "AWAITING_PAYMENT"
  | "PAYMENT_REVIEW"
  | "ASSEMBLING"
  | "SHIPPED"
  | "READY_FOR_PICKUP"
  | "COMPLETED"
  | "CANCELLED";

export type DeliveryMethod = "CDEK" | "RUSSIAN_POST" | "HAND";

export interface Bank {
  id: string;
  name: string;
  short: string;
  bg: string;
  fg: string;
}

export interface User {
  id: string;
  email: string | null;
  emailVerified: boolean;
  telegramId: string | null;
  telegramUsername: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  photoUrl: string | null;
  role: Role;
  createdAt: string;
}

export interface PublicConfig {
  storeName: string;
  botUsername: string;
  supportTelegram: string;
  supportEmail: string;
  pickupAddress: string;
  delivery: { method: DeliveryMethod; price: number }[];
  theme: { accentLight: string; accentDark: string; bgLight: string; bgDark: string };
  addressSuggest: boolean;
  banks: Bank[];
}

export interface Category {
  id: string;
  slug: string;
  name: string;
}

export interface ProductImage {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface Variant {
  id: string;
  size: string;
  color: string;
  price: number;
  available: boolean;
  lowStock: boolean;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: Category | null;
  price: number;
  oldPrice: number | null;
  images: ProductImage[];
  variants: Variant[];
  available: boolean;
}

export interface CartLine {
  id: string;
  variantId: string;
  productSlug: string;
  productTitle: string;
  size: string;
  color: string;
  image: string | null;
  unitPrice: number;
  quantity: number;
  maxQuantity: number;
  purchasable: boolean;
  issue: string | null;
}

export interface Cart {
  items: CartLine[];
  itemsTotal: number;
  count: number;
}

export interface PaymentDetails {
  sbpPhone: string;
  sbpBank: string;
  cardNumber: string;
  cardBank: string;
  recipientName: string;
  instructions: string;
}

export interface Order {
  id: string;
  number: number;
  status: OrderStatus;
  statusText: string;
  itemsTotal: number;
  deliveryPrice: number;
  total: number;
  contactName: string;
  contactPhone: string;
  deliveryMethod: DeliveryMethod;
  deliveryAddress: string;
  customerComment: string;
  trackingNumber: string;
  pickupInfo: string;
  rejectReason: string;
  payment: PaymentDetails | null;
  paymentDeadline: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: {
    id: string;
    variantId: string | null;
    productTitle: string;
    size: string;
    color: string;
    image: string | null;
    unitPrice: number;
    quantity: number;
  }[];
  history: { from: OrderStatus | null; to: OrderStatus; note: string; createdAt: string }[];
  receipts: { id: string; mimeType: string; createdAt: string; approved: boolean | null; note: string }[];
  adminComment?: string;
  userId?: string;
}

export interface SessionInfo {
  id: string;
  client: "WEB" | "MINIAPP" | "IOS";
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface AdminProduct {
  id: string;
  slug: string;
  title: string;
  description: string;
  categoryId: string | null;
  basePrice: number;
  oldPrice: number | null;
  isActive: boolean;
  sortOrder: number;
  images: ProductImage[];
  variants: {
    id: string;
    size: string;
    color: string;
    sku: string | null;
    price: number | null;
    stock: number;
    isActive: boolean;
  }[];
}

export interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

export interface AdminUser extends User {
  isBlocked: boolean;
  lastLoginAt: string | null;
  orderCount: number;
}

export interface PaymentSettings extends PaymentDetails {
  paymentWindowHours: number;
}

export interface StoreSettings {
  storeName: string;
  supportTelegram: string;
  supportEmail: string;
  pickupAddress: string;
  deliveryPrices: Record<DeliveryMethod, number>;
  deliveryEnabled: Record<DeliveryMethod, boolean>;
  accentLight: string;
  accentDark: string;
  bgLight: string;
  bgDark: string;
  botWelcome: string;
  botButton: string;
}
