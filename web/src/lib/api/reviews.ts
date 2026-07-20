import { HttpClient, API_BASE_URL } from '../http-clients';
import { ApiResponse, Review } from '@/types';

const httpClient = new HttpClient();

const DIRECT_API_URL =
  (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SERVER_URL)
    ? `${process.env.NEXT_PUBLIC_SERVER_URL}/api/v1`
    : API_BASE_URL;

async function multipartRequest<T>(path: string, method: string, formData: FormData): Promise<T> {
  const url = `${DIRECT_API_URL}${path}`;
  const response = await fetch(url, {
    method,
    body: formData,
    credentials: 'include',
  });

  const rawText = await response.text();
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(rawText || `HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
  }

  return data as T;
}

export const reviewsApi = {
  submitReview: (data: { orderId: string; productId: string; rating: number; comment?: string; images?: File[] }) => {
    const formData = new FormData();
    formData.append('orderId', data.orderId);
    formData.append('productId', data.productId);
    formData.append('rating', data.rating.toString());
    if (data.comment) formData.append('comment', data.comment);
    
    if (data.images && data.images.length > 0) {
      data.images.forEach(img => formData.append('images', img));
    }

    return multipartRequest<ApiResponse<Review>>('/reviews', 'POST', formData);
  },
  
  getProductReviews: (productId: string, page = 1) => {
    return httpClient.request<ApiResponse<Review[]>>(`/reviews/product/${productId}?page=${page}`);
  },
  
  // Admin Methods
  getAllAdminReviews: (page = 1) => {
    return httpClient.request<ApiResponse<Review[]>>(`/admin/reviews?page=${page}`);
  },

  updateReviewStatus: (id: string, status: 'pending' | 'approved' | 'rejected') => {
    return httpClient.request<ApiResponse<Review>>(`/admin/reviews/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  deleteReview: (id: string) => {
    return httpClient.request<ApiResponse<void>>(`/admin/reviews/${id}`, {
      method: 'DELETE',
    });
  }
};
