import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';
import { ConfigService } from '@config/config.service';

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: mockSend,
    },
  })),
}));

describe('MailService (TASK-24 / B-NOT-02)', () => {
  let service: MailService;
  let mockConfigService: Partial<ConfigService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService = {
      emailApiKey: 're_mock_test_api_key_123',
      emailFrom: 'Gramoz <noreply@gramoz.com>',
      adminEmail: 'admin@gramoz.com',
      frontendUrl: 'https://gramoz.com',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(MailService);
  });

  it('should send verification email with compiled template', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'email-1' }, error: null });

    await service.sendVerificationEmail(
      'customer@example.com',
      '123456',
      'John Doe',
    );

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Gramoz <noreply@gramoz.com>',
        to: 'customer@example.com',
        subject: 'Verify Your Email - Gramoz',
        html: expect.stringContaining('123456'),
      }),
    );
  });

  it('should send password reset email with compiled template', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'email-2' }, error: null });

    await service.sendPasswordResetEmail(
      'customer@example.com',
      'reset-999',
      'Jane Doe',
    );

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Gramoz <noreply@gramoz.com>',
        to: 'customer@example.com',
        subject: 'Reset Your Password - Gramoz',
        html: expect.stringContaining('reset-999'),
      }),
    );
  });

  it('should send welcome email', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'email-3' }, error: null });

    await service.sendWelcomeEmail('customer@example.com', 'Alice');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Gramoz <noreply@gramoz.com>',
        to: 'customer@example.com',
        subject: 'Welcome to Gramoz!',
        html: expect.stringContaining('Alice'),
      }),
    );
  });

  it('should send order confirmation email without throwing if API fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('Resend rate limit exceeded'));

    await expect(
      service.sendOrderConfirmation(
        'buyer@example.com',
        'Buyer Bob',
        'order-uuid-1234',
        [{ productName: 'Panjabi', quantity: 2, unitPrice: '1500.00' }],
        '3000.00',
      ),
    ).resolves.not.toThrow();

    expect(mockSend).toHaveBeenCalled();
  });

  it('should send low stock alert to admin email', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'email-4' }, error: null });

    await service.sendLowStockAlert([
      { name: 'Silk Saree', stock: 2, threshold: 5 },
    ]);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@gramoz.com',
        subject: expect.stringContaining('Low Stock'),
        html: expect.stringContaining('Silk Saree'),
      }),
    );
  });

  it('should skip low stock alert if ADMIN_EMAIL is not configured', async () => {
    (mockConfigService as any).adminEmail = '';

    await service.sendLowStockAlert([
      { name: 'Silk Saree', stock: 2, threshold: 5 },
    ]);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should send abandoned cart email and throw on failure for outbox retry', async () => {
    mockSend.mockRejectedValueOnce(new Error('SMTP Network error'));

    await expect(
      service.sendAbandonedCartEmail('cart-abandoner@example.com', 'Charlie', [
        { productName: 'Lungi', quantity: 1, unitPrice: '600.00' },
      ]),
    ).rejects.toThrow('SMTP Network error');
  });
});
