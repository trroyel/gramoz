export interface User {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  status: string;
  role?: string;
  createdAt: string;
}

export const PLATFORM_ROLES = ['super_admin', 'admin', 'support'];

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    user: User;
    token: string;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data: T;
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description?: string;
  price: string | number;
  stock: number;
  unit: string;
  images: string[];
  categoryId: string;
  categoryName?: string;
  status: string;
  createdAt: string;
}

export interface CartItem {
  id: string;
  quantity: number;
  productId: string;
  productName: string;
  productPrice: string;
  productImages: string[];
  productStock: number;
  productStatus: string;
}

export interface Cart {
  items: CartItem[];
  subtotal: string;
  itemCount: number;
}

export interface Address {
  id: string;
  userId: string;
  title: string;
  label?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  zipCode?: string;
  country?: string;
  isDefault: boolean;
}

export interface OrderItem {
  id: string;
  quantity: number;
  unitPrice: string;
  productName: string;
  productId: string;
}

export interface Order {
  id: string;
  userId: string;
  shippingAddressId: string;
  totalAmount: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  payment?: {
    status: 'pending' | 'completed' | 'failed' | 'refunded';
    method: string;
    transactionId: string | null;
  } | null;
  createdAt: string;
  items?: OrderItem[];
}

export interface CreateProductData {
  name: string;
  description?: string;
  price: number;
  stock: number;
  unit?: string;
  categoryId?: string;
  images?: File[];
}

export interface Wishlist {
  id: string;
  userId: string;
  productId: string;
  createdAt: string;
  product?: Product;
}

export interface Review {
  id: string;
  userId: string;
  productId: string;
  orderId: string;
  rating: number;
  comment?: string;
  images?: string[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  user?: {
    fullName: string;
    email?: string;
  };
  product?: {
    name: string;
  };
}

export interface LoyaltyPoint {
  id: string;
  userId: string;
  points: number;
  type: string;
  referenceId?: string;
  validUntil?: string;
  createdAt: string;
}

export interface Setting {
  key: string;
  value: string;
  description?: string;
  updatedAt: string;
}

export interface Refund {
  id: string;
  orderId: string;
  amount: string | number;
  reason: string;
  status: 'requested' | 'approved' | 'processed' | 'rejected';
  notes?: string;
  adminNotes?: string;
  gatewayRefundId?: string;
  createdAt: string;
  orderTotal?: string | number;
  customerName?: string;
  customerEmail?: string;
}
