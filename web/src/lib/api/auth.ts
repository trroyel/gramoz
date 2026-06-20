import { HttpClient } from '../http-clients';
import type { AuthResponse, ApiResponse, User } from '@/types';

const httpClient = new HttpClient();

export interface RegisterData {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface VerifyEmailData {
  email: string;
  code: string;
}

export interface ForgotPasswordData {
  email: string;
}

export interface ResetPasswordData {
  email: string;
  code: string;
  newPassword: string;
}

export const authApi = {
  register: (data: RegisterData) =>
    httpClient.request<ApiResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: LoginData) =>
    httpClient.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  verifyEmail: (data: VerifyEmailData) =>
    httpClient.request<ApiResponse>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resendVerification: (email: string) =>
    httpClient.request<ApiResponse>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  forgotPassword: (data: ForgotPasswordData) =>
    httpClient.request<ApiResponse>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resetPassword: (data: ResetPasswordData) =>
    httpClient.request<ApiResponse>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMe: () =>
    httpClient.request<ApiResponse<User>>('/auth/me', {
      method: 'GET',
    }),

  logout: () =>
    httpClient.request<ApiResponse>('/auth/logout', {
      method: 'POST',
    }),
};
