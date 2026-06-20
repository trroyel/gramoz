import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { User } from '@database/schema';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ─── SSLCommerz online payment ────────────────────────────────────────────

  // Prevents a user from spamming payment initiation and creating
  // duplicate pending payment records for the same order.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseGuards(JwtAuthGuard)
  @Post('initiate/:orderId')
  async initiate(
    @CurrentUser() user: User,
    @Param('orderId') orderId: string,
    @Body() body: { method?: string },
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const data = await this.paymentsService.initiatePayment(
      user.id,
      orderId,
      baseUrl,
      body?.method,
    );
    return res.send({ success: true, data });
  }

  // SSLCommerz gateway callbacks — NOT authenticated (called by SSLCommerz servers).
  // @SkipThrottle exempts these from the global rate limiter — blocking SSLCommerz IPs
  // would prevent legitimate payment confirmations from reaching the system.
  @SkipThrottle()
  @Post('sslcommerz/success')
  async successCallback(@Body() body: any, @Res() res: FastifyReply) {
    await this.paymentsService.verifyPayment(body);
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return res
      .code(302)
      .header('Location', `${frontendUrl}/checkout/success`)
      .send();
  }

  @SkipThrottle()
  @Post('sslcommerz/fail')
  async failCallback(@Body() body: any, @Res() res: FastifyReply) {
    await this.paymentsService.verifyPayment(body);
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return res
      .code(302)
      .header('Location', `${frontendUrl}/checkout/fail`)
      .send();
  }

  @SkipThrottle()
  @Post('sslcommerz/cancel')
  async cancelCallback(@Body() body: any, @Res() res: FastifyReply) {
    await this.paymentsService.handleCancelCallback(body);
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return res
      .code(302)
      .header('Location', `${frontendUrl}/checkout/cancel`)
      .send();
  }

  @SkipThrottle()
  @Post('sslcommerz/ipn')
  async ipnListener(@Body() body: any, @Res() res: FastifyReply) {
    await this.paymentsService.verifyPayment(body);
    return res.status(HttpStatus.OK).send('IPN Received');
  }

  // ─── Cash on Delivery ─────────────────────────────────────────────────────

  /**
   * POST /payments/cod/:orderId
   * Creates a payment record with method=COD and status=pending.
   * No gateway redirect — customer pays when the order arrives.
   * Admin marks it as paid/collected via the order management panel.
   */
  @UseGuards(JwtAuthGuard)
  @Post('cod/:orderId')
  async initiateCod(
    @CurrentUser() user: User,
    @Param('orderId') orderId: string,
    @Res() res: FastifyReply,
  ) {
    const payment = await this.paymentsService.initiateCod(user.id, orderId);
    return res.status(HttpStatus.CREATED).send({
      success: true,
      message: 'Cash on Delivery order confirmed. Pay when your order arrives.',
      data: payment,
    });
  }
}
