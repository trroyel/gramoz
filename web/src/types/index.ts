export interface User {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  status: string;
  createdAt: string;
}

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
  message: string;
  data: T;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description?: string;
  price: string | number;
  stock: number;
  imageUrl?: string;
  category: string;
  status: string;
  createdAt: string;
}

export interface CreateProductData {
  name: string;
  description?: string;
  price: number;
  stock: number;
  category?: string;
  image?: File;
}
