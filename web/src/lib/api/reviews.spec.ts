import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reviewsApi } from './reviews';
import { Review } from '@/types';

describe('Frontend Reviews API & Presentation Logic (TASK-11b)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('reviewsApi client endpoints', () => {
    it('requests product reviews with pagination', async () => {
      let requestedUrl = '';
      global.fetch = vi.fn().mockImplementation((url) => {
        requestedUrl = String(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, data: [] }),
        });
      });

      await reviewsApi.getProductReviews('prod-1', 2);
      expect(requestedUrl).toContain('/reviews/product/prod-1?page=2');
    });

    it('requests product review stats', async () => {
      let requestedUrl = '';
      global.fetch = vi.fn().mockImplementation((url) => {
        requestedUrl = String(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              success: true,
              data: { averageRating: 4.5, reviewCount: 12 },
            }),
        });
      });

      const res = await reviewsApi.getProductReviewStats('prod-1');
      expect(requestedUrl).toContain('/reviews/product/prod-1/stats');
      expect(res.data).toEqual({ averageRating: 4.5, reviewCount: 12 });
    });

    it('updates review status via admin endpoint', async () => {
      let requestedUrl = '';
      let method = '';
      let body = '';

      global.fetch = vi.fn().mockImplementation((url, init) => {
        requestedUrl = String(url);
        method = init?.method ?? 'GET';
        body = init?.body ?? '';
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              success: true,
              data: { id: 'rev-1', status: 'approved' },
            }),
        });
      });

      await reviewsApi.updateReviewStatus('rev-1', 'approved');
      expect(requestedUrl).toContain('/admin/reviews/rev-1/status');
      expect(method).toBe('PATCH');
      expect(JSON.parse(body)).toEqual({ status: 'approved' });
    });

    it('deletes review via admin endpoint', async () => {
      let requestedUrl = '';
      let method = '';

      global.fetch = vi.fn().mockImplementation((url, init) => {
        requestedUrl = String(url);
        method = init?.method ?? 'GET';
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true }),
        });
      });

      await reviewsApi.deleteReview('rev-1');
      expect(requestedUrl).toContain('/admin/reviews/rev-1');
      expect(method).toBe('DELETE');
    });
  });

  describe('Review Filtering & Formatting Logic', () => {
    const sampleReviews: Review[] = [
      {
        id: 'rev-1',
        userId: 'u1',
        productId: 'p1',
        orderId: 'o1',
        rating: 5,
        comment: 'Excellent product!',
        status: 'approved',
        createdAt: '2026-10-20T10:00:00Z',
        user: { fullName: 'Rahim Ahmed' },
      },
      {
        id: 'rev-2',
        userId: 'u2',
        productId: 'p1',
        orderId: 'o2',
        rating: 1,
        comment: 'Spam comment',
        status: 'rejected',
        createdAt: '2026-10-20T10:05:00Z',
      },
      {
        id: 'rev-3',
        userId: 'u3',
        productId: 'p1',
        orderId: 'o3',
        rating: 4,
        comment: 'Awaiting moderation',
        status: 'pending',
        createdAt: '2026-10-20T10:10:00Z',
      },
    ];

    it('filters out pending and rejected reviews from public presentation', () => {
      const approvedOnly = sampleReviews.filter((r) => r.status === 'approved');
      expect(approvedOnly).toHaveLength(1);
      expect(approvedOnly[0].id).toBe('rev-1');
      expect(approvedOnly.some((r) => r.status === 'rejected')).toBe(false);
      expect(approvedOnly.some((r) => r.status === 'pending')).toBe(false);
    });

    it('formats rating display precision and verified review count label', () => {
      const averageRating: number = 4.33;
      const reviewCountSingle: number = 1;
      const reviewCountPlural: number = 3;

      const formattedRating = averageRating.toFixed(1);
      expect(formattedRating).toBe('4.3');

      const labelSingle = `(${reviewCountSingle} verified ${reviewCountSingle === 1 ? 'review' : 'reviews'})`;
      expect(labelSingle).toBe('(1 verified review)');

      const labelPlural = `(${reviewCountPlural} verified ${reviewCountPlural === 1 ? 'review' : 'reviews'})`;
      expect(labelPlural).toBe('(3 verified reviews)');
    });

    it('handles zero review state correctly', () => {
      const reviews: Review[] = [];
      const approvedReviews = reviews.filter((r) => r.status === 'approved');
      const averageRating = 0;
      const reviewCount = 0;

      const hasReviews = approvedReviews.length > 0;
      const showRatingSummary = reviewCount > 0 && averageRating > 0;

      expect(hasReviews).toBe(false);
      expect(showRatingSummary).toBe(false);
    });
  });
});
