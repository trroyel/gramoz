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
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { User } from '@database/schema';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('initiate/:orderId')
  async initiate(
    @CurrentUser() user: User,
    @Param('orderId') orderId: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    // Determine the base URL for callbacks based on the incoming request
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const data = await this.paymentsService.initiatePayment(
      user.id,
      orderId,
      baseUrl,
    );
    return res.send({ success: true, data });
  }

  // IPN and Success callbacks are typically POST requests from SSLCommerz server
  // They should not have JwtAuthGuard because they are called by the gateway
  @Post('sslcommerz/success')
  async successCallback(@Body() body: any, @Res() res: FastifyReply) {
    const result = await this.paymentsService.verifyPayment(body);
    // Ideally, redirect the user back to the frontend success page
    // For now, we return JSON or redirect if we know the frontend URL
    return res.redirect('http://localhost:3000/checkout/success');
  }

  @Post('sslcommerz/fail')
  async failCallback(@Body() body: any, @Res() res: FastifyReply) {
    await this.paymentsService.verifyPayment(body);
    return res.redirect('http://localhost:3000/checkout/fail');
  }

  @Post('sslcommerz/cancel')
  async cancelCallback(@Body() body: any, @Res() res: FastifyReply) {
    await this.paymentsService.verifyPayment(body);
    return res.redirect('http://localhost:3000/checkout/cancel');
  }

  @Post('sslcommerz/ipn')
  async ipnListener(@Body() body: any, @Res() res: FastifyReply) {
    // IPN is called asynchronously by SSLCommerz
    await this.paymentsService.verifyPayment(body);
    return res.status(HttpStatus.OK).send('IPN Received');
  }
}
