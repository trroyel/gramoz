import { Test, TestingModule } from '@nestjs/testing';
import { SmsService, normalizeBangladeshiPhone } from './sms.service';
import { ConfigService } from '@config/config.service';

describe('SmsService & Bangladeshi Phone Normalization (TASK-24 / B-NOT-01)', () => {
  let service: SmsService;
  let mockConfigService: any;

  beforeEach(async () => {
    mockConfigService = {
      gwSmsToken: 'test-sms-token-xyz',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SmsService>(SmsService);
    jest.restoreAllMocks();
  });

  describe('normalizeBangladeshiPhone', () => {
    it('accepts valid 13-digit Bangladeshi numbers starting with 8801', () => {
      expect(normalizeBangladeshiPhone('8801712345678')).toBe('8801712345678');
      expect(normalizeBangladeshiPhone('8801812345678')).toBe('8801812345678');
      expect(normalizeBangladeshiPhone('8801912345678')).toBe('8801912345678');
      expect(normalizeBangladeshiPhone('8801312345678')).toBe('8801312345678');
      expect(normalizeBangladeshiPhone('8801412345678')).toBe('8801412345678');
      expect(normalizeBangladeshiPhone('8801512345678')).toBe('8801512345678');
      expect(normalizeBangladeshiPhone('8801612345678')).toBe('8801612345678');
    });

    it('normalizes 11-digit local numbers by prepending 88', () => {
      expect(normalizeBangladeshiPhone('01712345678')).toBe('8801712345678');
      expect(normalizeBangladeshiPhone('01899887766')).toBe('8801899887766');
    });

    it('strips leading plus sign and normalizes +8801 numbers', () => {
      expect(normalizeBangladeshiPhone('+8801712345678')).toBe('8801712345678');
    });

    it('cleans whitespace, dashes, and parentheses', () => {
      expect(normalizeBangladeshiPhone('+880 1712-345678')).toBe(
        '8801712345678',
      );
      expect(normalizeBangladeshiPhone('(017) 12-345678')).toBe(
        '8801712345678',
      );
    });

    it('rejects numbers with invalid operator codes (e.g. 010, 011, 012)', () => {
      expect(normalizeBangladeshiPhone('01012345678')).toBeNull();
      expect(normalizeBangladeshiPhone('01112345678')).toBeNull();
      expect(normalizeBangladeshiPhone('01212345678')).toBeNull();
    });

    it('rejects international or wrong-length numbers', () => {
      expect(normalizeBangladeshiPhone('+14155552671')).toBeNull();
      expect(normalizeBangladeshiPhone('017123')).toBeNull();
      expect(normalizeBangladeshiPhone('01712345678999')).toBeNull();
    });

    it('rejects alphanumeric or garbage input', () => {
      expect(normalizeBangladeshiPhone('01712abc678')).toBeNull();
      expect(normalizeBangladeshiPhone('')).toBeNull();
      expect(normalizeBangladeshiPhone(null as unknown as string)).toBeNull();
      expect(
        normalizeBangladeshiPhone(undefined as unknown as string),
      ).toBeNull();
    });
  });

  describe('sendSms (B-NOT-01)', () => {
    it('returns true and logs locally if GW_SMS_TOKEN is not configured', async () => {
      mockConfigService.gwSmsToken = '';

      const fetchSpy = jest.spyOn(global, 'fetch');
      const res = await service.sendSms('01712345678', 'Test Message');

      expect(res).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects invalid recipient without invoking external HTTP call', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const res = await service.sendSms('invalid-phone', 'Hello');

      expect(res).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('dispatches SMS to BulkSMSBD over HTTPS with normalized number and timeout', async () => {
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => '1101', // BulkSMSBD success response
      } as Response);

      const res = await service.sendSms(
        '01712345678',
        'Verification code 123456',
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.bdbulksms.net/api.php',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: expect.stringContaining('to=8801712345678'),
        }),
      );
      expect(res).toBe(true);
    });

    it('handles provider error codes (1002, 1003, 1006) as failure', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => '1006: Insufficient Balance',
      } as Response);

      const res = await service.sendSms('01712345678', 'Test message');
      expect(res).toBe(false);
    });

    it('handles HTTP error status codes gracefully without crashing', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      } as Response);

      const res = await service.sendSms('01712345678', 'Test message');
      expect(res).toBe(false);
    });

    it('handles network timeout or AbortSignal timeout gracefully', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValueOnce(new Error('Connection timed out'));

      const res = await service.sendSms('01712345678', 'Test message');
      expect(res).toBe(false);
    });
  });

  describe('Transactional Message Templates', () => {
    it('sendVerificationSms: formats verification code message', async () => {
      const sendSmsSpy = jest
        .spyOn(service, 'sendSms')
        .mockResolvedValueOnce(true);

      const res = await service.sendVerificationSms('01712345678', '458921');

      expect(res).toBe(true);
      expect(sendSmsSpy).toHaveBeenCalledWith(
        '01712345678',
        'Your Gramoz verification code is 458921. It expires in 10 minutes.',
      );
    });

    it('sendOrderShippedSms: formats message with tracking link when provided', async () => {
      const sendSmsSpy = jest
        .spyOn(service, 'sendSms')
        .mockResolvedValueOnce(true);

      const res = await service.sendOrderShippedSms(
        '01712345678',
        'abc12345-6789-0000',
        'https://steadfast.com.bd/t/SF-101',
      );

      expect(res).toBe(true);
      expect(sendSmsSpy).toHaveBeenCalledWith(
        '01712345678',
        'Gramoz: Your order #ABC12345 has been shipped! Track it here: https://steadfast.com.bd/t/SF-101',
      );
    });

    it('sendOrderShippedSms: formats message without link when trackingUrl is omitted', async () => {
      const sendSmsSpy = jest
        .spyOn(service, 'sendSms')
        .mockResolvedValueOnce(true);

      const res = await service.sendOrderShippedSms(
        '01712345678',
        'abc12345-6789-0000',
      );

      expect(res).toBe(true);
      expect(sendSmsSpy).toHaveBeenCalledWith(
        '01712345678',
        'Gramoz: Your order #ABC12345 has been shipped and is on its way!',
      );
    });

    it('sendOrderDeliveredSms: formats delivered notification message', async () => {
      const sendSmsSpy = jest
        .spyOn(service, 'sendSms')
        .mockResolvedValueOnce(true);

      const res = await service.sendOrderDeliveredSms(
        '01712345678',
        'xyz98765-1111-2222',
      );

      expect(res).toBe(true);
      expect(sendSmsSpy).toHaveBeenCalledWith(
        '01712345678',
        'Gramoz: Your order #XYZ98765 has been delivered. Thank you for shopping with us!',
      );
    });
  });
});
